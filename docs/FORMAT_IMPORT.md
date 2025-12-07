# Guide d'import des fichiers

## Principes généraux
Les imports acceptent les fichiers CSV et Excel (`.xls` / `.xlsx`). Le séparateur CSV est détecté automatiquement (`;` ou `,`). Seule la première feuille Excel est lue et les lignes masquées sont ignorées. Les noms sont normalisés (casse, espaces, accents) pour faciliter la correspondance avec les fichiers PDF présents dans le dossier sélectionné.

## Rapporteurs
### CSV : colonnes fichier + rapporteurs
| Colonne attendue | Contenu |
| --- | --- |
| `file` (ou 1re colonne) | Nom ou chemin du PDF à traiter (`dossier/dupont_jean.pdf`) |
| `reviewer 1`, `reviewer 2`, ... | Noms des rapporteurs (colonnes dont l'en-tête commence par `reviewer`) |

Exemple CSV :
```
file;reviewer 1;reviewer 2
dossiers/dupont_jean.pdf;Rapporteur A;Rapporteur B
martin_marie.pdf;Rapporteur C;
```

Règles :
- Les lignes sans fichier ou sans rapporteur sont ignorées.
- Les chemins sont utilisés tels quels ; assurez-vous que l'extension `.pdf` est présente.

### Excel : colonnes nom + rapporteurs
| Colonne attendue | Contenu |
| --- | --- |
| `Nom d'usage` / `Nom` | Nom du candidat |
| `Prénom` | Prénom du candidat |
| `Rapporteur 1`, `Rapporteur 2`, ... | Noms des rapporteurs (colonnes dont l'en-tête commence par `Rapporteur` ou `Reviewer`) |

Exemple Excel (1re feuille) :
| Nom d'usage | Prénom | Rapporteur 1 | Rapporteur 2 |
| --- | --- | --- | --- |
| Dupont | Jean | Rapporteur A | Rapporteur B |
| Martin | Marie | Rapporteur C |  |

Règles :
- Chaque ligne est associée automatiquement au PDF correspondant présent dans le dossier (nom normalisé). Si aucun PDF n'est trouvé, un nom de secours `Nom Prénom.pdf` est généré et signalé comme manquant dans l'interface.
- Les lignes vides ou masquées sont ignorées.

## Membres
### Modèle colonnes fichier + membres (CSV)
| Colonne attendue | Contenu |
| --- | --- |
| `Membre` / `Member` (ou `Nom` / `Name` en Excel) | Nom du membre |
| Colonnes suivantes | Références de fichiers pour ce membre, séparées par `;` ou retour à la ligne |

Exemple CSV :
```
Membre;Fichier 1;Fichier 2
Dupont Jean;dossiers/dupont_jean.pdf;sample_1/
Marie Martin;.;*.pdf
```

Règles :
- Laisser les colonnes de fichiers vides attribue **tous les PDF** du dossier au membre.
- Les références sont dédupliquées ; les noms de membre sont fusionnés sans tenir compte de la casse.

### Variante liste simple (CSV)
Si aucune colonne `Membre`/`Member` n'est présente, chaque cellule (en-têtes inclus) est interprétée comme un nom de membre. Aucun fichier n'est renseigné : chaque membre recevra alors l'ensemble des PDF du dossier.

### Références de fichiers acceptées
| Forme | Effet |
| --- | --- |
| `document.pdf` ou `dossier/fichier.pdf` | Sélectionne un PDF précis (correspondance insensible à la casse) |
| `dossier/` ou `dossier` | Sélectionne tous les PDF dans le dossier indiqué |
| `.` | Sélectionne uniquement les PDF à la racine du dossier de travail |
| `*.pdf` ou `sample_*/*.pdf` | Sélection par motif (joker `*`) |
| `Prénom Nom` | Référence par nom : l'application cherche le PDF correspondant ; à défaut elle essaie `Prénom Nom.pdf` |

💡 Les noms de fichiers trouvés automatiquement sont triés et normalisés ; si une référence ne correspond à rien, elle est consignée dans le journal.
