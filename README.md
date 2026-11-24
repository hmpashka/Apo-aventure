# Apo aventure

Atelier d'écriture de roman à choix : personnages, relations, chronologie, graphe des choix avec jauges et conditions, éditeur de scène, mode lecture, boîte à idées, export Word pour KDP.

Un seul programme tourne sur le Mac. Il sert l'application dans le navigateur (Mac et iPhone sur le même Wi-Fi) et range tout dans `~/Documents/Apo aventure`.

## Installer sur le Mac

Double-clic sur **Installer Apo aventure.command**. Le programme est copié dans `~/Applications/Apo aventure`, il est lancé une première fois et le navigateur s'ouvre sur `http://localhost:4321`. Il ne démarre **jamais** tout seul à l'ouverture de session : pour le lancer, double-clic sur **Démarrer Apo aventure** dans `~/Applications/Apo aventure`.

Au premier lancement, choisis un code d'accès. Sur l'iPhone, scanne le QR code de l'accueil (ou de Réglages), puis dans Safari : Partager, « Sur l'écran d'accueil ».

Arrêter : bouton « Arrêter l'appli » (barre latérale ou Réglages). Tout est enregistré avant l'arrêt. Relancer : double-clic sur « Démarrer Apo aventure » dans `~/Applications/Apo aventure`.

Désinstaller : `~/Applications/Apo\ aventure/apo uninstall` (les données restent).

## Où sont les données

```
Documents/Apo aventure/
  Ma saga/                 un dossier par saga (saga.json)
    Tome 1/                un sous-dossier par roman (projet.json)
      personnages/*.json
      relations/*.json
      scenes/*.json + *.md  le texte des scènes est en Markdown
      choix/*.json
      variables/*.json     jauges et drapeaux
      evenements/*.json  lieux/*.json  idees/*.json
      .historique/         anciennes versions des scènes
      .corbeille/          éléments supprimés
```

Tout reste lisible sans l'outil, compatible Time Machine et Git.

## Sécurité et sauvegarde

- Code d'accès demandé une fois par appareil.
- Chaque frappe est enregistrée après une courte pause. Hors Wi-Fi, le texte reste sur l'iPhone et repart dès que le Mac répond.
- Si une scène a été modifiée sur un autre appareil entre-temps, l'outil demande quelle version garder.

## Développer

Go 1.22+. `go run . -data /tmp/apo-test` lance un serveur de test ; `./build.sh` produit les binaires Mac dans `dist/`.
