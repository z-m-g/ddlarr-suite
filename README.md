# DDL Torznab

Indexeur Torznab pour sites DDL (Direct Download Links), compatible avec Prowlarr, Sonarr et Radarr.

## Architecture

Le projet se compose de 3 services Docker :

| Service | Port par défaut | Description |
|---------|-----------------|-------------|
| **ddl-torznab** | 9117 | Indexeur Torznab qui scrape les sites DDL |
| **dlprotect-resolver** | 5000 | Service Botasaurus pour résoudre les liens dl-protect |
| **ddl-downloader** | 9118 | Surveille un dossier blackhole et envoie les liens aux clients de téléchargement |

> Les ports sont configurables via les variables `INDEXER_PORT`, `DOWNLOADER_PORT`, `DLPROTECT_RESOLVER_PORT`

## Sites supportés

| Site | Variable ENV | Description |
|------|--------------|-------------|
| WawaCity | `WAWACITY_URL` | Scraping HTML |
| Zone-Téléchargement | `ZONETELECHARGER_URL` | Scraping HTML |

## Installation

### 1. Cloner le repository

```bash
git clone https://github.com/votre-repo/ddl_torznab.git
cd ddl_torznab
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Éditer le fichier `.env` :

```bash
# URLs des sites (au moins un requis)
WAWACITY_URL=https://www.wawacity.xxx/
ZONETELECHARGER_URL=https://www.zone-telechargement.xxx/

# Chemin du dossier blackhole (requis pour le downloader)
BLACKHOLE_PATH=/chemin/vers/blackhole

# Clé API AllDebrid (optionnel mais recommandé)
ALLDEBRID_API_KEY=votre_cle_api
```

### 3. Lancer les services

```bash
docker-compose up -d
```

### 4. Configurer le downloader

Accéder à l'interface web : http://localhost:9118

Configurer votre client de téléchargement (JDownloader, aria2, ou Download Station).

## Configuration de Radarr

### Étape 1 : Ajouter l'indexeur Torznab

1. Aller dans **Settings > Indexers > Add**
2. Choisir **Torznab**
3. Configurer :
   - **Name** : DDL Wawacity (ou ZoneTelecharger)
   - **URL** : `http://<IP>:9117/api/wawacity/` (ou `zonetelecharger`)
   - **API Key** : `ddl-torznab` (n'importe quelle valeur)
   - **Categories** : 2000, 2040, 2045
4. Cliquer sur **Test** puis **Save**

> Remplacer `<IP>` par l'adresse du serveur (ex: `192.168.1.100`, `localhost`, ou votre domaine)

### Étape 2 : Configurer le Download Client Blackhole

1. Aller dans **Settings > Download Clients > Add**
2. Choisir **Torrent Blackhole**
3. Configurer :
   - **Name** : DDL Blackhole
   - **Torrent Folder** : `/chemin/vers/blackhole` (même que `BLACKHOLE_PATH`)
   - **Watch Folder** : `/chemin/vers/downloads` (où vos fichiers seront téléchargés par JDownloader/aria2)
   - **Save Magnet Files** : Non (désactivé)
4. Cliquer sur **Test** puis **Save**

## Configuration de Sonarr

### Étape 1 : Ajouter l'indexeur Torznab

1. Aller dans **Settings > Indexers > Add**
2. Choisir **Torznab**
3. Configurer :
   - **Name** : DDL Wawacity (ou ZoneTelecharger)
   - **URL** : `http://<IP>:9117/api/wawacity/` (ou `zonetelecharger`)
   - **API Key** : `ddl-torznab` (n'importe quelle valeur)
   - **Categories** : 5000, 5040, 5045
   - **Anime Categories** : 5070 (optionnel)
4. Cliquer sur **Test** puis **Save**

> Remplacer `<IP>` par l'adresse du serveur (ex: `192.168.1.100`, `localhost`, ou votre domaine)

### Étape 2 : Configurer le Download Client Blackhole

1. Aller dans **Settings > Download Clients > Add**
2. Choisir **Torrent Blackhole**
3. Configurer :
   - **Name** : DDL Blackhole
   - **Torrent Folder** : `/chemin/vers/blackhole` (même que `BLACKHOLE_PATH`)
   - **Watch Folder** : `/chemin/vers/downloads` (où vos fichiers seront téléchargés par JDownloader/aria2)
   - **Save Magnet Files** : Non (désactivé)
4. Cliquer sur **Test** puis **Save**

## URLs Torznab disponibles

| Site | URL |
|------|-----|
| Wawacity | `http://<IP>:9117/api/wawacity/` |
| ZoneTelecharger | `http://<IP>:9117/api/zonetelecharger/` |

> Remplacer `<IP>` par l'adresse du serveur (ex: `192.168.1.100`, `localhost`, ou votre domaine)

### Fonctionnement du flux complet

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Radarr/     │────>│ ddl-torznab  │────>│ Site DDL        │
│ Sonarr      │     │ (recherche)  │     │ (wawacity, etc) │
└─────────────┘     └──────────────┘     └─────────────────┘
       │
       │ télécharge .torrent
       ▼
┌─────────────┐     ┌───────────────┐     ┌─────────────────┐
│ Blackhole   │────>│ ddl-downloader│────>│ JDownloader/    │
│ folder      │     │ (supprime le  │     │ aria2/DS        │
└─────────────┘     │  .torrent)    │     └─────────────────┘
                    └───────────────┘             │
                                                  │ télécharge
                                                  ▼
                                         ┌─────────────────┐
                                         │ Downloads       │
                                         │ folder          │
                                         └─────────────────┘
```

1. **Radarr/Sonarr** recherche un film/série via l'indexeur Torznab
2. L'indexeur retourne des résultats avec des liens `.torrent` (contenant des liens DDL)
3. Radarr/Sonarr télécharge le `.torrent` dans le **dossier blackhole**
4. Le service **ddl-downloader** détecte le nouveau fichier
5. Il extrait le lien DDL et l'envoie au **client de téléchargement** configuré
6. Le fichier `.torrent` est **supprimé** (ou déplacé vers `processed/` si `DEBUG=true`)
7. Le client télécharge le fichier dans le **dossier downloads** surveillé par Radarr/Sonarr

## Configuration des clients de téléchargement

### JDownloader

Accédez à http://localhost:9118 pour configurer.

**Via l'API locale (recommandé si sur le même réseau) :**
- **API Mode** : Local API only
- **Host** : IP de la machine JDownloader (ex: 192.168.1.100)
- **Port** : 3128 (par défaut)

**Via MyJDownloader (accès distant) :**
- **API Mode** : MyJDownloader only
- **Email** : votre email MyJDownloader
- **Password** : votre mot de passe
- **Device Name** : nom exact de votre appareil JDownloader

### aria2

- **Host** : localhost (ou IP du serveur aria2)
- **Port** : 6800
- **Secret** : votre token RPC (optionnel)
- **Download Directory** : chemin de téléchargement

### Synology Download Station

- **Host** : IP du NAS
- **Port** : 5000 (ou 5001 pour HTTPS)
- **Username/Password** : identifiants DSM
- **Use SSL** : cocher si port 5001

## AllDebrid

AllDebrid permet de débrider les liens des hébergeurs premium (1fichier, Uptobox, etc.) pour des téléchargements plus rapides.

1. Créer un compte sur [AllDebrid](https://alldebrid.com/)
2. Générer une clé API : https://alldebrid.com/apikeys/
3. Ajouter la clé dans `.env` : `ALLDEBRID_API_KEY=votre_cle`
4. Ou via l'interface web du downloader (http://localhost:9118)

## Variables d'environnement

Voir `.env.example` pour la liste complète.

| Variable | Description | Défaut |
|----------|-------------|--------|
| `INDEXER_PORT` | Port de l'indexeur Torznab | 9117 |
| `DOWNLOADER_PORT` | Port du downloader | 9118 |
| `DLPROTECT_RESOLVER_PORT` | Port du résolveur dl-protect | 5000 |
| `WAWACITY_URL` | URL de WawaCity | - |
| `ZONETELECHARGER_URL` | URL de Zone-Téléchargement | - |
| `BLACKHOLE_PATH` | Dossier blackhole | - |
| `ALLDEBRID_API_KEY` | Clé API AllDebrid | - |
| `DEBUG` | Mode debug (voir ci-dessous) | false |
| `DS_ENABLED` | Activer Download Station | false |
| `JD_ENABLED` | Activer JDownloader | false |
| `ARIA2_ENABLED` | Activer aria2 | false |

> Au moins une URL de site (`WAWACITY_URL` ou `ZONETELECHARGER_URL`) doit être configurée.

### Mode Debug

Par défaut (`DEBUG=false`), les fichiers `.torrent` sont **supprimés** après traitement.

En mode debug (`DEBUG=true`), les fichiers sont **déplacés** vers le dossier `processed/` pour inspection.

```bash
# Dans .env
DEBUG=true
```

## Catégories Torznab

| Catégorie | Code | Description |
|-----------|------|-------------|
| Movies | 2000 | Films |
| Movies/HD | 2040 | Films HD (720p, 1080p) |
| Movies/UHD | 2045 | Films 4K |
| TV | 5000 | Séries |
| TV/HD | 5040 | Séries HD |
| TV/UHD | 5045 | Séries 4K |
| Anime | 5070 | Anime |

## Structure du projet

```
ddl_torznab/
├── docker-compose.yml          # Configuration Docker
├── .env.example                # Template variables d'environnement
├── .env                        # Variables d'environnement (à créer)
├── indexer/                    # Service Torznab (port 9117)
│   └── src/
│       ├── scrapers/           # Scrapers pour chaque site
│       ├── routes/             # API Torznab
│       └── utils/              # Utilitaires (XML, HTTP, dl-protect)
├── downloader/                 # Service Blackhole Downloader (port 9118)
│   └── src/
│       ├── clients/            # Clients de téléchargement (JD, aria2, DS)
│       ├── routes/             # API de configuration
│       └── watcher.ts          # Surveillance du blackhole
└── botasaurus-service/         # Service de résolution dl-protect (port 5000)
    └── main.py
```

## Dépannage

### Les recherches ne retournent rien

- Vérifier que les URLs des sites sont correctes et accessibles
- Consulter les logs : `docker-compose logs ddl-torznab`

### Les liens ne sont pas résolus

- Vérifier que le service dlprotect-resolver fonctionne : `docker-compose logs dlprotect-resolver`
- Le premier démarrage peut prendre du temps (téléchargement de Chromium)

### Le downloader ne détecte pas les fichiers

- Vérifier les permissions du dossier blackhole
- Vérifier que le chemin est correct dans docker-compose.yml
- Consulter les logs : `docker-compose logs ddl-downloader`

### JDownloader ne reçoit pas les liens

- Vérifier que l'API locale est activée dans JDownloader (Settings > Advanced > API)
- Ou vérifier vos identifiants MyJDownloader
- Tester la connexion via l'interface web du downloader

## Développement

```bash
# Indexer
cd indexer
npm install
npm run dev

# Downloader
cd downloader
npm install
npm run dev
```

## Licence

MIT
