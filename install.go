package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

const label = "fr.apo.aventure"

// Le programme ne démarre JAMAIS tout seul à l'ouverture de session : la
// description launchd est rangée à côté du programme (pas dans LaunchAgents),
// et ne sert qu'à le relancer s'il plante pendant qu'il tourne.
// On le démarre d'un double-clic sur « Démarrer Apo aventure.command ».

func plistFile(exe string) string { return filepath.Join(filepath.Dir(exe), label+".plist") }

// install : prépare le démarrage manuel et lance l'appli une première fois.
func install() {
	if runtime.GOOS != "darwin" {
		fmt.Println("L'installation ne fonctionne que sur macOS.")
		return
	}
	exe, _ := os.Executable()
	exe, _ = filepath.EvalSymlinks(exe)
	home, _ := os.UserHomeDir()
	logDir := filepath.Join(home, "Library", "Logs")
	os.MkdirAll(logDir, 0o755)
	// ancienne version : retirer le démarrage automatique
	old := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	if exists(old) {
		exec.Command("launchctl", "unload", old).Run()
		os.Remove(old)
	}
	plistPath := plistFile(exe)
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key><array><string>%s</string><string>-data</string><string>%s</string><string>-port</string><string>%d</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, label, exe, dataRoot, port, filepath.Join(logDir, "apo-aventure.log"), filepath.Join(logDir, "apo-aventure.log"))
	if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
		fmt.Println("Erreur :", err)
		os.Exit(1)
	}
	writeStartScript(filepath.Dir(exe), plistPath)
	exec.Command("launchctl", "unload", plistPath).Run()
	if out, err := exec.Command("launchctl", "load", plistPath).CombinedOutput(); err != nil {
		fmt.Println("Erreur launchctl :", err, string(out))
		os.Exit(1)
	}
	fmt.Printf("Apo aventure est installé et lancé. Il ne démarre pas tout seul avec la session :\nrelance-le avec « Démarrer Apo aventure » dans %s.\nOuvre %s (ou http://localhost:%d sur ce Mac).\nDonnées : %s\n", filepath.Dir(exe), appURL(), port, dataRoot)
}

func uninstall() {
	exe, _ := os.Executable()
	exe, _ = filepath.EvalSymlinks(exe)
	home, _ := os.UserHomeDir()
	for _, p := range []string{plistFile(exe), filepath.Join(home, "Library", "LaunchAgents", label+".plist")} {
		exec.Command("launchctl", "unload", p).Run()
		os.Remove(p)
	}
	fmt.Println("Apo aventure est arrêté et désinstallé. Tes données sont intactes :", dataRoot)
}

// writeStartScript dépose « Démarrer Apo aventure.command » à côté du programme.
func writeStartScript(dir, plistPath string) {
	script := fmt.Sprintf(`#!/bin/sh
# Double-clic : démarre Apo aventure (ou le redémarre s'il tournait déjà).
launchctl unload "%s" 2>/dev/null
launchctl load "%s"
sleep 1
open "http://localhost:%d"
`, plistPath, plistPath, port)
	os.WriteFile(filepath.Join(dir, "Démarrer Apo aventure.command"), []byte(script), 0o755)
}

// hShutdown attend la fin des écritures en cours, répond, puis arrête le serveur.
// Une sortie normale (code 0) n'est pas relancée par launchd.
func hShutdown(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		jsonErr(w, 405, "méthode")
		return
	}
	mu.Lock() // plus aucune écriture ne peut commencer
	writeJSON(w, map[string]any{"ok": true})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	log.Printf("Arrêt demandé depuis l'application : données enregistrées, arrêt.")
	go func() {
		time.Sleep(400 * time.Millisecond)
		os.Exit(0)
	}()
}
