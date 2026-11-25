package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// Export « livre dont vous êtes le héros » : chaque scène devient une section
// numérotée, et chaque choix renvoie au numéro de la section suivante.
// Les jauges et conditions sont écrites en clair pour que le lecteur les suive.

type exScene struct {
	ID, Titre, Texte string
	Chap             float64
	Fin              string
	N                int
}

type exChoice struct {
	De, Vers, Texte string
	Cond            []any
	Eff             []any
}

func loadAll(dir, coll string) []map[string]any {
	out := []map[string]any{}
	es, _ := os.ReadDir(filepath.Join(dir, coll))
	for _, e := range es {
		if strings.HasSuffix(e.Name(), ".json") {
			if m, err := readObj(dir, coll, strings.TrimSuffix(e.Name(), ".json")); err == nil {
				out = append(out, m)
			}
		}
	}
	return out
}

func num(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case string:
		var f float64
		fmt.Sscan(x, &f)
		return f
	}
	return 0
}

func hExport(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dir, err := projDir(q.Get("path"))
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	var projet map[string]any
	b, err := os.ReadFile(filepath.Join(dir, "projet.json"))
	if err != nil {
		jsonErr(w, 404, "Projet introuvable")
		return
	}
	json.Unmarshal(b, &projet)
	notes := q.Get("notes") == "1"

	vars := map[string]map[string]any{}
	for _, v := range loadAll(dir, "variables") {
		vars[v["id"].(string)] = v
	}
	scenes := map[string]*exScene{}
	all := []*exScene{}
	for _, s := range loadAll(dir, "scenes") {
		sc := &exScene{ID: s["id"].(string), Titre: str(s["titre"], "Sans titre"), Texte: str(s["texte"], ""), Chap: num(s["chap"]), Fin: str(s["fin"], "")}
		scenes[sc.ID] = sc
		all = append(all, sc)
	}
	choices := map[string][]exChoice{}
	for _, c := range loadAll(dir, "choix") {
		ch := exChoice{De: str(c["de"], ""), Vers: str(c["vers"], ""), Texte: str(c["texte"], "")}
		ch.Cond, _ = c["cond"].([]any)
		ch.Eff, _ = c["eff"].([]any)
		choices[ch.De] = append(choices[ch.De], ch)
	}
	for k := range choices {
		sort.SliceStable(choices[k], func(i, j int) bool { return choices[k][i].Texte < choices[k][j].Texte })
	}
	// ordre : parcours en largeur depuis la scène de départ, puis le reste par chapitre
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].Chap != all[j].Chap {
			return all[i].Chap < all[j].Chap
		}
		return all[i].Titre < all[j].Titre
	})
	start := str(projet["depart"], "")
	if _, ok := scenes[start]; !ok && len(all) > 0 {
		start = all[0].ID
	}
	order := []*exScene{}
	seen := map[string]bool{}
	queue := []string{start}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if seen[id] || scenes[id] == nil {
			continue
		}
		seen[id] = true
		order = append(order, scenes[id])
		for _, c := range choices[id] {
			queue = append(queue, c.Vers)
		}
	}
	for _, s := range all {
		if !seen[s.ID] {
			order = append(order, s)
		}
	}
	for i, s := range order {
		s.N = i + 1
	}

	varName := func(id string) string {
		if v, ok := vars[id]; ok {
			return str(v["nom"], id)
		}
		return id
	}
	condText := func(cond []any) string {
		parts := []string{}
		for _, c := range cond {
			a, _ := c.([]any)
			if len(a) < 3 {
				continue
			}
			vid, _ := a[0].(string)
			op, _ := a[1].(string)
			if bv, ok := a[2].(bool); ok {
				if bv {
					parts = append(parts, "tu as coché « "+varName(vid)+" »")
				} else {
					parts = append(parts, "tu n'as pas coché « "+varName(vid)+" »")
				}
				continue
			}
			sym := map[string]string{">=": "au moins", "<=": "au plus", "=": "exactement", ">": "plus de", "<": "moins de"}[op]
			parts = append(parts, fmt.Sprintf("ta jauge « %s » vaut %s %v", varName(vid), sym, a[2]))
		}
		return strings.Join(parts, " et ")
	}
	effText := func(eff []any) string {
		parts := []string{}
		for _, e := range eff {
			a, _ := e.([]any)
			if len(a) < 2 {
				continue
			}
			vid, _ := a[0].(string)
			if bv, ok := a[1].(bool); ok {
				if bv {
					parts = append(parts, "coche « "+varName(vid)+" »")
				} else {
					parts = append(parts, "décoche « "+varName(vid)+" »")
				}
				continue
			}
			n := num(a[1])
			if n >= 0 {
				parts = append(parts, fmt.Sprintf("ajoute %v à « %s »", n, varName(vid)))
			} else {
				parts = append(parts, fmt.Sprintf("retire %v à « %s »", -n, varName(vid)))
			}
		}
		return strings.Join(parts, ", ")
	}

	type para struct {
		Style, Text string
		Break       bool
		Rich        bool
	}
	doc := []para{{Style: "Title", Text: str(projet["titre"], "Sans titre")}}
	if res := str(projet["resume"], ""); res != "" {
		doc = append(doc, para{Style: "Normal", Text: res, Break: false})
	}
	// feuille de jauges pour le lecteur
	if len(vars) > 0 {
		doc = append(doc, para{Style: "Heading2", Text: "Ta feuille d'aventure", Break: false})
		ids := []string{}
		for id := range vars {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			v := vars[id]
			if str(v["type"], "") == "drapeau" {
				doc = append(doc, para{Style: "Normal", Text: "☐ " + varName(id), Break: false})
			} else {
				doc = append(doc, para{Style: "Normal", Text: fmt.Sprintf("%s : départ %v", varName(id), v["depart"]), Break: false})
			}
		}
	}
	for _, s := range order {
		doc = append(doc, para{Style: "Heading1", Text: fmt.Sprintf("%d", s.N), Break: true})
		if notes {
			doc = append(doc, para{Style: "Note", Text: s.Titre, Break: false})
		}
		for _, p := range strings.Split(strings.ReplaceAll(s.Texte, "\r", ""), "\n") {
			if strings.TrimSpace(plainText(p)) != "" {
				doc = append(doc, para{Style: "Normal", Text: p, Rich: true})
			}
		}
		if s.Fin != "" {
			doc = append(doc, para{Style: "End", Text: "FIN", Break: false})
			continue
		}
		for _, c := range choices[s.ID] {
			t, ok := scenes[c.Vers]
			if !ok {
				continue
			}
			line := c.Texte
			if ct := condText(c.Cond); ct != "" {
				line = "Si " + ct + " : " + lowerFirst(line)
			}
			if et := effText(c.Eff); et != "" {
				line += " (" + et + ")"
			}
			line += fmt.Sprintf(" → rends-toi au %d.", t.N)
			doc = append(doc, para{Style: "Choice", Text: line, Break: false})
		}
	}

	name := safeName(str(projet["titre"], "export"))
	if q.Get("fmt") == "docx" {
		var body strings.Builder
		for i, p := range doc {
			brk := ""
			if p.Break && i > 0 {
				brk = `<w:r><w:br w:type="page"/></w:r>`
			}
			runs := `<w:r><w:t xml:space="preserve">` + xmlEsc(p.Text) + `</w:t></w:r>`
			if p.Rich {
				runs = richRuns(p.Text)
			}
			body.WriteString(fmt.Sprintf(`<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>%s%s</w:p>`, p.Style, brk, runs))
		}
		data := makeDocx(body.String())
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name+".docx"))
		w.Write(data)
		return
	}
	var md strings.Builder
	for _, p := range doc {
		switch p.Style {
		case "Title":
			md.WriteString("# " + p.Text + "\n\n")
		case "Heading1":
			md.WriteString("\n---\n\n## " + p.Text + "\n\n")
		case "Heading2":
			md.WriteString("## " + p.Text + "\n\n")
		case "Note":
			md.WriteString("_" + p.Text + "_\n\n")
		case "Choice":
			md.WriteString("- " + p.Text + "\n")
		case "End":
			md.WriteString("**FIN**\n\n")
		default:
			t := p.Text
			if p.Rich {
				t = spanRe.ReplaceAllString(t, "")
			}
			md.WriteString(t + "\n\n")
		}
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+url.PathEscape(name+".md"))
	w.Write([]byte(md.String()))
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	return strings.ToLower(string(r[0])) + string(r[1:])
}

func xmlEsc(s string) string {
	var b bytes.Buffer
	for _, r := range s {
		switch r {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		default:
			if r >= 0x20 || r == '\t' {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

func makeDocx(body string) []byte {
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	add := func(name, content string) {
		f, _ := z.Create(name)
		f.Write([]byte(content))
	}
	add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`)
	add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)
	add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
	add("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="24"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:ind w:firstLine="340"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="600"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="480" w:after="240"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:i/><w:color w:val="888888"/><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Choice"><w:name w:val="Choice"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="340" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="End"><w:name w:val="End"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="360"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:spacing w:val="40"/></w:rPr></w:style>
</w:styles>`)
	add("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`+body+`<w:sectPr><w:pgSz w:w="8640" w:h="12960"/><w:pgMar w:top="1080" w:right="900" w:bottom="1080" w:left="1080" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`)
	z.Close()
	return buf.Bytes()
}

// Texte des scènes : **gras**, *italique*, <u>souligné</u>,
// <span class="t-s|t-l|t-xl">taille</span>, \* pour une étoile.
var spanRe = regexp.MustCompile(`</?span[^>]*>`)

func plainText(s string) string {
	s = spanRe.ReplaceAllString(s, "")
	s = strings.NewReplacer("<u>", "", "</u>", "", `\*`, "\x00", "*", "").Replace(s)
	return strings.ReplaceAll(s, "\x00", "*")
}

// richRuns transforme une ligne mise en forme en suites <w:r> Word.
func richRuns(line string) string {
	sizes := map[string]int{"t-s": 20, "t-l": 30, "t-xl": 36}
	var out, cur strings.Builder
	bold, ital, und := false, false, false
	stack := []int{}
	emit := func() {
		if cur.Len() == 0 {
			return
		}
		rpr := ""
		if bold {
			rpr += "<w:b/>"
		}
		if ital {
			rpr += "<w:i/>"
		}
		if und {
			rpr += `<w:u w:val="single"/>`
		}
		if len(stack) > 0 && stack[len(stack)-1] > 0 {
			rpr += fmt.Sprintf(`<w:sz w:val="%d"/>`, stack[len(stack)-1])
		}
		if rpr != "" {
			rpr = "<w:rPr>" + rpr + "</w:rPr>"
		}
		out.WriteString("<w:r>" + rpr + `<w:t xml:space="preserve">` + xmlEsc(cur.String()) + "</w:t></w:r>")
		cur.Reset()
	}
	for i := 0; i < len(line); {
		rest := line[i:]
		switch {
		case strings.HasPrefix(rest, `\*`):
			cur.WriteByte('*')
			i += 2
		case strings.HasPrefix(rest, "**"):
			emit()
			bold = !bold
			i += 2
		case rest[0] == '*':
			emit()
			ital = !ital
			i++
		case strings.HasPrefix(rest, "<u>"):
			emit()
			und = true
			i += 3
		case strings.HasPrefix(rest, "</u>"):
			emit()
			und = false
			i += 4
		case strings.HasPrefix(rest, "<span"):
			emit()
			j := strings.Index(rest, ">")
			if j < 0 {
				j = len(rest) - 1
			}
			sz := 0
			for k, v := range sizes {
				if strings.Contains(rest[:j], `"`+k+`"`) {
					sz = v
				}
			}
			stack = append(stack, sz)
			i += j + 1
		case strings.HasPrefix(rest, "</span>"):
			emit()
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
			i += 7
		default:
			cur.WriteByte(line[i])
			i++
		}
	}
	emit()
	return out.String()
}
