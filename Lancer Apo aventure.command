#!/bin/sh
# Double-clic : lance Apo aventure depuis ce dossier.
# Le programme et les données restent dans le dossier partagé :
#   apo/apo-aventure/          le programme (ce dossier)
#   apo/Données Apo aventure/  ton roman
# Laisse cette fenêtre ouverte tant que tu écris. Pour arrêter : bouton
# « Arrêter l'appli » dans Apo aventure (ou ferme cette fenêtre).
cd "$(dirname "$0")"
DATA="$(cd .. && pwd)/Données Apo aventure"
if [ "$(uname -m)" = "arm64" ]; then BIN="dist/apo-mac-arm64"; else BIN="dist/apo-mac-intel"; fi
chmod +x "$BIN" 2>/dev/null
xattr -d com.apple.quarantine "$BIN" 2>/dev/null
echo "Apo aventure démarre…"
echo "Données : $DATA"
echo
( sleep 2; open "http://localhost:4321" ) &
"./$BIN" -data "$DATA"
echo
echo "Apo aventure est arrêté. Tu peux fermer cette fenêtre."
