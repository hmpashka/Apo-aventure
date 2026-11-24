// Apo aventure : atelier d'écriture de roman à choix.
// Un seul programme : il sert l'application web et range les données
// dans un dossier lisible (JSON + Markdown), un fichier par objet.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

//go:embed web
var webFS embed.FS

var (
	dataRoot string
	port     int
	mu       sync.Mutex
	cfg      config
)

type config struct {
	Salt     string `json:"salt"`
	CodeHash string `json:"codeHash"`
	Secret   string `json:"secret"`
}

// Collections d'objets d'un projet : un sous-dossier chacune.
var collections = []string{"personnages", "relations", "scenes", "choix", "variables", "evenements", "lieux", "idees", "intrigues"}

func main() {
	home, _ := os.UserHomeDir()
	flag.StringVar(&dataRoot, "data", filepath.Join(home, "Documents", "Apo aventure"), "dossier des données")
	flag.IntVar(&port, "port", 4321, "port réseau")
	flag.Parse()

	if flag.Arg(0) == "install" {
		install()
		return
	}
	if flag.Arg(0) == "uninstall" {
		uninstall()
		return
	}

	must(os.MkdirAll(filepath.Join(dataRoot, ".apo"), 0o755))
	loadConfig()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/state", hState)
	mux.HandleFunc("/api/setup", hSetup)
	mux.HandleFunc("/api/login", hLogin)
	mux.HandleFunc("/api/logout", hLogout)
	mux.HandleFunc("/api/qr.png", auth(hQR))
	mux.HandleFunc("/api/info", auth(hInfo))
	mux.HandleFunc("/api/projects", auth(hProjects))
	mux.HandleFunc("/api/project", auth(hProject))
	mux.HandleFunc("/api/obj", auth(hObj))
	mux.HandleFunc("/api/history", auth(hHistory))
	mux.HandleFunc("/api/export", auth(hExport))
	sub, _ := fs.Sub(webFS, "web")
	static := http.FileServer(http.FS(sub))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		static.ServeHTTP(w, r)
	})

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Apo aventure démarre sur http://%s:%d (données : %s)", localName(), port, dataRoot)
	log.Fatal(http.ListenAndServe(addr, logReq(mux)))
}

func logReq(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			log.Printf("%s %s", r.Method, r.URL.Path)
		}
		h.ServeHTTP(w, r)
	})
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

// ---------- configuration et code d'accès ----------

func loadConfig() {
	b, err := os.ReadFile(filepath.Join(dataRoot, ".apo", "config.json"))
	if err == nil {
		json.Unmarshal(b, &cfg)
	}
	if cfg.Secret == "" {
		cfg.Secret = randHex(32)
		saveConfig()
	}
}

func saveConfig() {
	b, _ := json.MarshalIndent(cfg, "", "  ")
	writeAtomic(filepath.Join(dataRoot, ".apo", "config.json"), b)
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func hashCode(code string) string {
	h := sha256.Sum256([]byte(cfg.Salt + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(h[:])
}

func token() string {
	m := hmac.New(sha256.New, []byte(cfg.Secret))
	m.Write([]byte("apo-session:" + cfg.CodeHash))
	return hex.EncodeToString(m.Sum(nil))
}

func logged(r *http.Request) bool {
	if cfg.CodeHash == "" {
		return false
	}
	c, err := r.Cookie("apo")
	return err == nil && hmac.Equal([]byte(c.Value), []byte(token()))
}

func auth(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !logged(r) {
			jsonErr(w, 401, "Code d'accès requis")
			return
		}
		h(w, r)
	}
}

func setCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: "apo", Value: token(), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().AddDate(1, 0, 0)})
}

func hState(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"needSetup": cfg.CodeHash == "", "logged": logged(r)})
}

func hSetup(w http.ResponseWriter, r *http.Request) {
	var in struct{ Code string }
	json.NewDecoder(r.Body).Decode(&in)
	mu.Lock()
	defer mu.Unlock()
	// premier lancement, ou changement de code par quelqu'un de déjà connecté
	if cfg.CodeHash != "" && !logged(r) {
		jsonErr(w, 403, "Un code existe déjà")
		return
	}
	if len(strings.TrimSpace(in.Code)) < 4 {
		jsonErr(w, 400, "Le code doit faire au moins 4 caractères")
		return
	}
	cfg.Salt = randHex(8)
	cfg.CodeHash = hashCode(in.Code)
	saveConfig()
	setCookie(w)
	writeJSON(w, map[string]any{"ok": true})
}

var failMu sync.Mutex
var fails = map[string][]time.Time{}

func hLogin(w http.ResponseWriter, r *http.Request) {
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	failMu.Lock()
	recent := []time.Time{}
	for _, t := range fails[ip] {
		if time.Since(t) < 10*time.Minute {
			recent = append(recent, t)
		}
	}
	fails[ip] = recent
	failMu.Unlock()
	if len(recent) >= 8 {
		jsonErr(w, 429, "Trop d'essais. Réessaie dans 10 minutes.")
		return
	}
	var in struct{ Code string }
	json.NewDecoder(r.Body).Decode(&in)
	if cfg.CodeHash == "" || !hmac.Equal([]byte(hashCode(in.Code)), []byte(cfg.CodeHash)) {
		failMu.Lock()
		fails[ip] = append(fails[ip], time.Now())
		failMu.Unlock()
		jsonErr(w, 403, "Code incorrect")
		return
	}
	setCookie(w)
	writeJSON(w, map[string]any{"ok": true})
}

func hLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "apo", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- adresse réseau ----------

func localName() string {
	// Sur macOS, le vrai nom Bonjour est le LocalHostName (le nom d'hôte peut venir de la box).
	if out, err := exec.Command("scutil", "--get", "LocalHostName").Output(); err == nil {
		if n := strings.TrimSpace(string(out)); n != "" {
			return n + ".local"
		}
	}
	h, _ := os.Hostname()
	h = strings.TrimSuffix(h, ".local")
	h = strings.TrimSuffix(h, ".home")
	h = strings.TrimSuffix(h, ".lan")
	if h == "" {
		return "localhost"
	}
	return h + ".local"
}

func lanIPs() []string {
	out := []string{}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && !ipn.IP.IsLoopback() && ipn.IP.To4() != nil {
			out = append(out, ipn.IP.String())
		}
	}
	return out
}

func appURL() string { return fmt.Sprintf("http://%s:%d", localName(), port) }

func hInfo(w http.ResponseWriter, r *http.Request) {
	ips := []string{}
	for _, ip := range lanIPs() {
		ips = append(ips, fmt.Sprintf("http://%s:%d", ip, port))
	}
	writeJSON(w, map[string]any{"url": appURL(), "ips": ips, "data": dataRoot})
}

func hQR(w http.ResponseWriter, r *http.Request) {
	u := r.URL.Query().Get("u")
	if u == "" {
		u = appURL()
	}
	png, err := qrcode.Encode(u, qrcode.Medium, 256)
	if err != nil {
		jsonErr(w, 500, err.Error())
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Write(png)
}

// ---------- projets (romans et sagas) ----------

type projNode struct {
	Path     string      `json:"path"`
	Titre    string      `json:"titre"`
	Type     string      `json:"type"` // "saga" ou "roman"
	Genre    string      `json:"genre,omitempty"`
	Modif    int64       `json:"modif"`
	Children []*projNode `json:"children,omitempty"`
}

func scanProjects(rel string, depth int) []*projNode {
	out := []*projNode{}
	entries, err := os.ReadDir(filepath.Join(dataRoot, rel))
	if err != nil || depth > 3 {
		return out
	}
	for _, e := range entries {
		if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.ToSlash(filepath.Join(rel, e.Name()))
		dir := filepath.Join(dataRoot, p)
		if b, err := os.ReadFile(filepath.Join(dir, "projet.json")); err == nil {
			var m map[string]any
			json.Unmarshal(b, &m)
			fi, _ := os.Stat(filepath.Join(dir, "projet.json"))
			n := &projNode{Path: p, Titre: str(m["titre"], e.Name()), Type: "roman", Genre: str(m["genre"], ""), Modif: lastModif(dir, fi.ModTime())}
			out = append(out, n)
		} else if b, err := os.ReadFile(filepath.Join(dir, "saga.json")); err == nil {
			var m map[string]any
			json.Unmarshal(b, &m)
			n := &projNode{Path: p, Titre: str(m["titre"], e.Name()), Type: "saga", Children: scanProjects(p, depth+1)}
			out = append(out, n)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Titre < out[j].Titre })
	return out
}

func lastModif(dir string, t time.Time) int64 {
	m := t
	for _, c := range collections {
		es, _ := os.ReadDir(filepath.Join(dir, c))
		for _, e := range es {
			if fi, err := e.Info(); err == nil && fi.ModTime().After(m) {
				m = fi.ModTime()
			}
		}
	}
	return m.UnixMilli()
}

func str(v any, def string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return def
}

var badChars = regexp.MustCompile(`[/\\:*?"<>|\x00-\x1f]`)

func safeName(s string) string {
	s = strings.TrimSpace(badChars.ReplaceAllString(s, "-"))
	s = strings.Trim(s, ". ")
	if s == "" {
		s = "Sans titre"
	}
	if len(s) > 80 {
		s = s[:80]
	}
	return s
}

// projDir vérifie qu'un chemin relatif reste dans le dossier des données.
func projDir(rel string) (string, error) {
	clean := filepath.Clean("/" + rel)
	if clean == "/" || strings.Contains(rel, "..") {
		return "", errors.New("chemin invalide")
	}
	return filepath.Join(dataRoot, clean), nil
}

func hProjects(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case "GET":
		writeJSON(w, scanProjects("", 0))
	case "POST":
		var in struct {
			Titre, Type, Parent, Genre, Resume string
		}
		json.NewDecoder(r.Body).Decode(&in)
		mu.Lock()
		defer mu.Unlock()
		parent := dataRoot
		if in.Parent != "" {
			d, err := projDir(in.Parent)
			if err != nil {
				jsonErr(w, 400, err.Error())
				return
			}
			parent = d
		}
		name := safeName(in.Titre)
		dir := filepath.Join(parent, name)
		for i := 2; exists(dir); i++ {
			dir = filepath.Join(parent, fmt.Sprintf("%s (%d)", name, i))
		}
		must2(w, os.MkdirAll(dir, 0o755))
		now := time.Now().Format(time.RFC3339)
		if in.Type == "saga" {
			b, _ := json.MarshalIndent(map[string]any{"titre": in.Titre, "cree": now}, "", "  ")
			writeAtomic(filepath.Join(dir, "saga.json"), b)
		} else {
			b, _ := json.MarshalIndent(map[string]any{"titre": in.Titre, "genre": in.Genre, "resume": in.Resume, "chapitres": 3, "cree": now}, "", "  ")
			writeAtomic(filepath.Join(dir, "projet.json"), b)
			for _, c := range collections {
				os.MkdirAll(filepath.Join(dir, c), 0o755)
			}
		}
		rel, _ := filepath.Rel(dataRoot, dir)
		writeJSON(w, map[string]any{"path": filepath.ToSlash(rel)})
	default:
		jsonErr(w, 405, "méthode")
	}
}

func exists(p string) bool { _, err := os.Stat(p); return err == nil }

func must2(w http.ResponseWriter, err error) {
	if err != nil {
		panic(err)
	}
}

// rev : empreinte de version d'un fichier (date de modification en nanosecondes).
func rev(paths ...string) string {
	var m int64
	for _, p := range paths {
		if fi, err := os.Stat(p); err == nil && fi.ModTime().UnixNano() > m {
			m = fi.ModTime().UnixNano()
		}
	}
	if m == 0 {
		return ""
	}
	return strconv.FormatInt(m, 36)
}

func readObj(dir, coll, id string) (map[string]any, error) {
	jp := filepath.Join(dir, coll, id+".json")
	b, err := os.ReadFile(jp)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	m["id"] = id
	paths := []string{jp}
	if coll == "scenes" {
		mp := filepath.Join(dir, coll, id+".md")
		t, _ := os.ReadFile(mp)
		m["texte"] = string(t)
		paths = append(paths, mp)
	}
	m["_rev"] = rev(paths...)
	return m, nil
}

func hProject(w http.ResponseWriter, r *http.Request) {
	dir, err := projDir(r.URL.Query().Get("path"))
	if err != nil {
		jsonErr(w, 400, err.Error())
		return
	}
	if r.Method == "PUT" {
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		mu.Lock()
		defer mu.Unlock()
		old := map[string]any{}
		if b, err := os.ReadFile(filepath.Join(dir, "projet.json")); err == nil {
			json.Unmarshal(b, &old)
		}
		for k, v := range in {
			old[k] = v
		}
		b, _ := json.MarshalIndent(old, "", "  ")
		writeAtomic(filepath.Join(dir, "projet.json"), b)
		writeJSON(w, old)
		return
	}
	b, err := os.ReadFile(filepath.Join(dir, "projet.json"))
	if err != nil {
		jsonErr(w, 404, "Projet introuvable")
		return
	}
	var projet map[string]any
	json.Unmarshal(b, &projet)
	out := map[string]any{"projet": projet}
	for _, c := range collections {
		list := []map[string]any{}
		es, _ := os.ReadDir(filepath.Join(dir, c))
		for _, e := range es {
			if !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			id := strings.TrimSuffix(e.Name(), ".json")
			if m, err := readObj(dir, c, id); err == nil {
				list = append(list, m)
			}
		}
		out[c] = list
	}
	writeJSON(w, out)
}

var idRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

func validColl(c string) bool {
	for _, x := range collections {
		if x == c {
			return true
		}
	}
	return false
}

// hObj : création, modification (avec détection de conflit) et suppression d'un objet.
func hObj(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dir, err := projDir(q.Get("path"))
	coll, id := q.Get("coll"), q.Get("id")
	if err != nil || !validColl(coll) || !idRe.MatchString(id) {
		jsonErr(w, 400, "requête invalide")
		return
	}
	jp := filepath.Join(dir, coll, id+".json")
	mp := filepath.Join(dir, coll, id+".md")
	mu.Lock()
	defer mu.Unlock()
	switch r.Method {
	case "PUT":
		var in struct {
			Data    map[string]any `json:"data"`
			BaseRev *string        `json:"baseRev"`
			Force   bool           `json:"force"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 20<<20)).Decode(&in); err != nil || in.Data == nil {
			jsonErr(w, 400, "données invalides")
			return
		}
		cur := rev(jp, mp)
		if !in.Force && in.BaseRev != nil && cur != "" && *in.BaseRev != cur {
			now, _ := readObj(dir, coll, id)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(409)
			json.NewEncoder(w).Encode(map[string]any{"error": "conflit", "current": now})
			return
		}
		os.MkdirAll(filepath.Join(dir, coll), 0o755)
		data := in.Data
		delete(data, "_rev")
		delete(data, "id")
		if coll == "scenes" {
			texte, _ := data["texte"].(string)
			delete(data, "texte")
			old, _ := os.ReadFile(mp)
			if string(old) != texte {
				snapshot(dir, id, old)
				writeAtomic(mp, []byte(texte))
			}
		}
		data["modifie"] = time.Now().Format(time.RFC3339)
		if _, ok := data["cree"]; !ok {
			data["cree"] = data["modifie"]
		}
		b, _ := json.MarshalIndent(data, "", "  ")
		writeAtomic(jp, b)
		obj, _ := readObj(dir, coll, id)
		writeJSON(w, obj)
	case "DELETE":
		// on ne détruit rien : l'objet part dans la corbeille du projet
		trash := filepath.Join(dir, ".corbeille", coll)
		os.MkdirAll(trash, 0o755)
		stamp := time.Now().Format("20060102-150405")
		os.Rename(jp, filepath.Join(trash, id+"-"+stamp+".json"))
		if exists(mp) {
			os.Rename(mp, filepath.Join(trash, id+"-"+stamp+".md"))
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		jsonErr(w, 405, "méthode")
	}
}

// snapshot garde l'ancienne version d'une scène, au plus une toutes les 10 minutes.
func snapshot(dir, id string, old []byte) {
	if len(strings.TrimSpace(string(old))) == 0 {
		return
	}
	hd := filepath.Join(dir, ".historique", id)
	os.MkdirAll(hd, 0o755)
	es, _ := os.ReadDir(hd)
	if len(es) > 0 {
		if fi, err := es[len(es)-1].Info(); err == nil && time.Since(fi.ModTime()) < 10*time.Minute {
			return
		}
	}
	writeAtomic(filepath.Join(hd, time.Now().Format("2006-01-02_15-04-05")+".md"), old)
}

func hHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	dir, err := projDir(q.Get("path"))
	id := q.Get("id")
	if err != nil || !idRe.MatchString(id) {
		jsonErr(w, 400, "requête invalide")
		return
	}
	hd := filepath.Join(dir, ".historique", id)
	if v := q.Get("v"); v != "" {
		if !regexp.MustCompile(`^[0-9_-]+\.md$`).MatchString(v) {
			jsonErr(w, 400, "version invalide")
			return
		}
		b, err := os.ReadFile(filepath.Join(hd, v))
		if err != nil {
			jsonErr(w, 404, "version introuvable")
			return
		}
		writeJSON(w, map[string]any{"texte": string(b)})
		return
	}
	es, _ := os.ReadDir(hd)
	list := []string{}
	for i := len(es) - 1; i >= 0; i-- {
		list = append(list, es[i].Name())
	}
	writeJSON(w, list)
}

// ---------- utilitaires ----------

func writeAtomic(p string, b []byte) error {
	tmp := p + ".tmp-" + randHex(4)
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(v)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{"error": msg})
}
