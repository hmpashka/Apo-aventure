package main

// Verrou : un seul Mac à la fois sur le même dossier de données
// (dossier partagé ou synchronisé). Le Mac qui tourne met à jour le verrou
// toutes les 30 secondes ; un verrou plus vieux que 2 minutes est ignoré.

import (
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

type lockInfo struct {
	Host string    `json:"mac"`
	PID  int       `json:"pid"`
	Beat time.Time `json:"vu"`
}

func lockPath() string { return filepath.Join(dataRoot, ".apo", "verrou.json") }

func takeLock() {
	me := localName()
	if b, err := os.ReadFile(lockPath()); err == nil {
		var l lockInfo
		if json.Unmarshal(b, &l) == nil && time.Since(l.Beat) < 2*time.Minute {
			if l.Host != me {
				fmt.Printf("\nApo aventure est déjà ouvert sur un autre Mac (%s).\nArrête-le là-bas (bouton « Arrêter l'appli »), attends que le dossier partagé se synchronise, puis relance.\n\n", l.Host)
				os.Exit(2)
			}
			if l.PID != os.Getpid() && syscall.Kill(l.PID, 0) == nil {
				fmt.Printf("\nApo aventure tourne déjà sur ce Mac : ouvre http://localhost:%d\n\n", port)
				os.Exit(3)
			}
		}
	}
	beat := func() {
		b, _ := json.MarshalIndent(lockInfo{me, os.Getpid(), time.Now()}, "", "  ")
		writeAtomic(lockPath(), b)
	}
	beat()
	go func() {
		for range time.Tick(30 * time.Second) {
			beat()
		}
	}()
	// fermeture de la fenêtre Terminal ou Ctrl-C : on libère le verrou
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM, syscall.SIGHUP)
	go func() {
		<-sig
		mu.Lock()
		releaseLock()
		os.Exit(0)
	}()
}

func releaseLock() { os.Remove(lockPath()) }
