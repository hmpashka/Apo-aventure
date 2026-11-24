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

// install : démarrage automatique à l'ouverture de session sur le Mac (launchd).
func install() {
	if runtime.GOOS != "darwin" {
		fmt.Println("L'installation automatique ne fonctionne que sur macOS.")
		return
	}
	exe, _ := os.Executable()
	exe, _ = filepath.EvalSymlinks(exe)
	home, _ := os.UserHomeDir()
	logDir := filepath.Join(home, "Library", "Logs")
	os.MkdirAll(logDir, 0o755)
	plistPath := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	os.MkdirAll(filepath.Dir(plistPath), 0o755)
	plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>%s</string>
  <key>ProgramArguments</key><array><string>%s</string><string>-data</string><string>%s</string><string>-port</string><string>%d</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>%s</string>
  <key>StandardErrorPath</key><string>%s</string>
</dict>
</plist>
`, label, exe, dataRoot, port, filepath.Join(logDir, "apo-aventure.log"), filepath.Join(logDir, "apo-aventure.log"))
	if err := os.WriteFile(plistPath, []byte(plist), 0o644); err != nil {
		fmt.Println("Erreur :", err)
		os.Exit(1)
	}
	exec.Command("launchctl", "unload", plistPath).Run()
	if out, err := exec.Command("launchctl", "load", "-w", plistPath).CombinedOutput(); err != nil {
		fmt.Println("Erreur launchctl :", err, string(out))
		os.Exit(1)
	}
	writeStartScript(filepath.Dir(exe), plistPath)
	fmt.Printf("Apo aventure est installé et démarre avec la session.\nOuvre %s (ou http://localhost:%d sur ce Mac).\nDonnées : %s\n", appURL(), port, dataRoot)
}

func uninstall() {
	home, _ := os.UserHomeDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	exec.Command("launchctl", "unload", plistPath).Run()
	os.Remove(plistPath)
	fmt.Println("Démarrage automatique retiré. Tes données sont intactes :", dataRoot)
}

// writeStartScript dépose « Démarrer Apo aventure.command » à côté du programme,
// pour relancer l'appli d'un double-clic après un arrêt.
func writeStartScript(dir, plistPath string) {
	script := fmt.Sprintf(`#!/bin/sh
# Double-clic : relance Apo aventure après un arrêt.
launchctl load -w "%s" 2>/dev/null || true
sleep 1
open "http://localhost:%d"
`, plistPath, port)
	p := filepath.Join(dir, "Démarrer Apo aventure.command")
	os.WriteFile(p, []byte(script), 0o755)
}

// hShutdown attend la fin des écritures en cours, répond, puis arrête le serveur.
// Lancé par launchd, il se retire de launchd jusqu'à la prochaine ouverture de
// session (ou un double-clic sur « Démarrer Apo aventure »), sinon launchd le relancerait.
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
		home, _ := os.UserHomeDir()
		plistPath := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
		if runtime.GOOS == "darwin" && os.Getenv("XPC_SERVICE_NAME") == label && exists(plistPath) {
			// sans -w : le démarrage automatique reste actif pour la prochaine session
			exec.Command("launchctl", "unload", plistPath).Run()
		}
		os.Exit(0)
	}()
}
