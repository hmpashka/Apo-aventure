package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
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
	fmt.Printf("Apo aventure est installé et démarre avec la session.\nOuvre %s (ou http://localhost:%d sur ce Mac).\nDonnées : %s\n", appURL(), port, dataRoot)
}

func uninstall() {
	home, _ := os.UserHomeDir()
	plistPath := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
	exec.Command("launchctl", "unload", plistPath).Run()
	os.Remove(plistPath)
	fmt.Println("Démarrage automatique retiré. Tes données sont intactes :", dataRoot)
}
