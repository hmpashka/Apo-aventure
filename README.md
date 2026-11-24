# Apo aventure

Atelier d'écriture de roman à choix : personnages, relations, chronologie, graphe des choix avec jauges et conditions, éditeur de scène, mode lecture, boîte à idées, export Word pour KDP.

Tout reste dans le dossier partagé : le programme et les données. N'importe quel Mac qui a accès au dossier peut lancer l'appli et retrouve le même roman, **un seul Mac à la fois** (un verrou l'empêche).

```
apo/
  apo-aventure/                   ce dépôt (le programme)
    Lancer Apo aventure.command   double-clic pour lancer
    dist/                         programmes compilés (Mac Apple et Intel)
  Données Apo aventure/           ton roman, créé au premier lancement
```

## Lancer

Double-clic sur **Lancer Apo aventure.command**. Une fenêtre Terminal s'ouvre (laisse-la ouverte), puis le navigateur sur `http://localhost:4321`. Rien n'est installé sur le Mac et rien ne démarre tout seul.

Au premier lancement, choisis un code d'accès. Sur l'iPhone (même Wi-Fi), scanne le QR code de l'accueil ou de Réglages, puis dans Safari : Partager, « Sur l'écran d'accueil ».

## Arrêter

Bouton **Arrêter l'appli** (barre latérale ou Réglages) : tout est enregistré, puis l'appli s'arrête et libère le verrou. Fermer la fenêtre Terminal arrête aussi l'appli.

## Changer de Mac

Arrête l'appli sur le premier Mac, attends que le dossier partagé se synchronise, puis lance-la sur l'autre. Si elle est encore ouverte ailleurs, le lanceur le dit et ne démarre pas. Un verrou de plus de 2 minutes sans signe de vie (Mac éteint brutalement) est ignoré.

## Où sont les données

```
Données Apo aventure/
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

Tout reste lisible sans l'outil.

## Sécurité et sauvegarde

- Code d'accès demandé une fois par appareil.
- Chaque frappe est enregistrée après une courte pause. Hors Wi-Fi, le texte reste sur l'iPhone et repart dès que le Mac répond.
- Si une scène a été modifiée sur un autre appareil entre-temps, l'outil demande quelle version garder.

## Développer

Go 1.22+. `go run . -data /tmp/apo-test` lance un serveur de test ; `./build.sh` produit les programmes Mac dans `dist/`.
