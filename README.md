# DDL Torznab

Indexeur Torznab pour sites DDL (Direct Download Links), compatible avec Prowlarr, Sonarr et Radarr.

## Quick Install (Docker)

```bash
# 1. Download docker-compose and .env files
curl -O https://raw.githubusercontent.com/z-m-g/ddlarr-suite/main/docker-compose.prod.yml
curl -O https://raw.githubusercontent.com/z-m-g/ddlarr-suite/main/.env.example
mv .env.example .env

# 2. Edit .env with your settings (debrid API key, site URLs, etc.)
nano .env

# 3. Create download directories
mkdir -p downloads downloads-temp

# 4. Start services
docker compose -f docker-compose.prod.yml up -d

# Start with FlareSolverr (optional, required for Bookys if Cloudflare is active)
docker compose -f docker-compose.prod.yml up -d flaresolverr
```

**Access:**
- Torznab Indexer: `http://localhost:9117`
- qBittorrent UI: `http://localhost:8080` (admin/adminadmin)
- FlareSolverr: `http://localhost:8191` (interne par défaut)

## Update

```bash
# Pull latest images and restart services
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Versions des images

Chaque release publie les images sur GHCR sous plusieurs tags. `docker-compose.prod.yml` utilise `latest` par défaut.

| Tag | Exemple | Pointe vers |
|---|---|---|
| `latest` | `ddl-torznab:latest` | La dernière release publiée |
| `X.Y.Z` | `ddl-torznab:1.1.0` | Une version figée, ne bouge jamais |
| `X.Y` | `ddl-torznab:1.1` | La dernière correction de la ligne mineure (suit les `1.1.x`) |
| `<sha>` | `ddl-torznab:9e58b36` | Le commit exact de la release |

Pour épingler une version précise, renseignez `DDLARR_VERSION` dans votre `.env` : `docker-compose.prod.yml` l'applique aux quatre images (`latest` par défaut).

```bash
# Dans .env
DDLARR_VERSION=1.3      # ou 1.3.0 pour une version figée
```

Les pre-releases publient leurs tags de version mais ne déplacent jamais `latest` : c'est le moyen de les tester sans toucher aux installations qui suivent `latest`.

Les 4 images (`ddl-torznab`, `dlprotect-resolver`, `ddl-qbittorrent`, `darkiworld`) suivent la même numérotation : gardez-les sur la même version. Les notes de la release sont attachées aux images comme description OCI, visible sur la page du package GHCR.

> Les prereleases (`v1.2.0-rc1`) ne reçoivent volontairement ni tag de version ni `latest` : elles restent accessibles uniquement par leur sha.

**Configure in Radarr/Sonarr:**
1. Add Indexer: Settings > Indexers > Torznab > URL: `http://<IP>:9117` > API Path: `/api/wawacity` (ou `/api/bookys` pour les ebooks)
2. Add Download Client: Settings > Download Clients > qBittorrent > Host: `<IP>`, Port: `8080`

## Soutien
☕ Après minuit, je code. Je bois du café — pas d’eau (c’est dangereux pour les gremlins).  
<a href="https://www.buymeacoffee.com/z.m.g"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me a Coffee" height="40"></a>


## Architecture

Le projet se compose de plusieurs services Docker. Deux approches sont possibles :

### Option A : DDL-qBittorrent (Recommandé)

| Service | Port par défaut | Description |
|---------|-----------------|-------------|
| **ddl-torznab** | 9117 | Indexeur Torznab qui scrape les sites DDL |
| **dlprotect-resolver** | 5000 | Service Botasaurus (navigateur réel) : résolution dl-protect, connexion Loadix |
| **ddl-qbittorrent** | 8080 | Simule un client qBittorrent pour Sonarr/Radarr |

Cette approche simule un vrai client qBittorrent. Sonarr/Radarr communiquent directement avec ddl-qbittorrent comme s'il s'agissait d'un vrai client torrent.

**Supporte les vrais torrents !** En plus des fake torrents DDL, ddl-qbittorrent peut recevoir de vrais fichiers .torrent et les envoyer automatiquement aux services de debrid (AllDebrid, RealDebrid, Premiumize) pour telechargement.

### Option B : Blackhole + Client externe

| Service | Port par défaut | Description |
|---------|-----------------|-------------|
| **ddl-torznab** | 9117 | Indexeur Torznab qui scrape les sites DDL |
| **dlprotect-resolver** | 5000 | Service Botasaurus pour résoudre les liens dl-protect |
| **ddl-downloader** | 9118 | Surveille un dossier blackhole et envoie les liens aux clients de téléchargement |

Cette approche utilise un dossier blackhole et un client de téléchargement externe (JDownloader, aria2, Download Station).

> Les ports sont configurables via les variables d'environnement

## Sites supportés

| Site | Variable ENV | Mastodon | Description |
|------|--------------|----------|-------------|
| WawaCity | `WAWACITY_URL` | [@wawacity](https://mamot.fr/@wawacity) | Scraping HTML |
| Zone-Téléchargement | `ZONETELECHARGER_URL` | [@ZT](https://mamot.fr/@ZT) | Scraping HTML |
| Bookys | `BOOKYS_URL` | - | Journaux, magazines, ebooks |
| Loadix | `LOADIX_URL` | - | Films, séries, animes (API JSON, compte requis) |

> **Auto-détection des URLs** : Si les variables `WAWACITY_URL` ou `ZONETELECHARGER_URL` sont vides, les URLs sont lues dans la bio des comptes Mastodon officiels (« Url officielle : … »), via l'API publique de l'instance.

> **Bookys** : L'URL actuelle est `https://www7.bookys-ebooks.com` (pas d'auto-détection : à mettre à jour si le domaine change). Le site est protégé par Cloudflare : configurer FlareSolverr (voir ci-dessous). Seuls les liens des hébergeurs listés dans `BOOKYS_HOSTER` sont gardés (`1fichier` par défaut) ; la plupart des journaux récents ne sont plus que sur Nitroflare, utiliser par exemple `BOOKYS_HOSTER=nitroflare,1fichier`.

> **Loadix** : la recherche passe par l'API publique du site, mais la révélation des liens exige une session. Voir [Loadix](#loadix) ci-dessous.

## Installation

### 1. Cloner le repository

```bash
git clone git@github.com:z-m-g/ddlarr-suite.git
cd ddlarr-suite
```

### 2. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Éditer le fichier `.env` :

```bash
# URLs des sites (optionnel - auto-détection depuis Mastodon si vide)
# Laissez vide pour utiliser l'auto-détection, ou forcez une URL spécifique
WAWACITY_URL=
ZONETELECHARGER_URL=

# Bookys (journaux, magazines, ebooks)
BOOKYS_URL=https://www7.bookys-ebooks.com
# Hébergeurs gardés pour Bookys (séparés par des virgules, défaut : 1fichier)
# BOOKYS_HOSTER=nitroflare,1fichier

# FlareSolverr (optionnel - requis pour Bookys si Cloudflare est actif)
# FLARESOLVERR_URL=http://flaresolverr:8191

# Chemin du dossier blackhole (requis pour le downloader)
BLACKHOLE_PATH=/chemin/vers/blackhole

# Clé API AllDebrid (optionnel mais recommandé)
ALLDEBRID_API_KEY=votre_cle_api
```

> **Note** : Les URLs des sites changent régulièrement. L'auto-détection depuis Mastodon permet de toujours avoir les URLs à jour sans modifier la configuration.

### 3. Lancer les services

Choisir une des deux options :

**Option A - DDL-qBittorrent (Recommandé) :**
```bash
docker compose --profile qbittorrent up -d
```

**Option B - Blackhole + Client externe :**
```bash
docker compose --profile blackhole up -d
```

> **Note** : `docker compose up -d` (sans profil) ne démarre que les services de base (indexeur + résolveur). Vous devez spécifier un profil pour avoir un système de téléchargement complet.

### 4. Arrêter les services

Pour arrêter tous les services (incluant tous les profils) :

```bash
docker compose --profile qbittorrent --profile blackhole down
```

## Configuration avec DDL-qBittorrent (Option A - Recommandé)

### Lancer les services

```bash
docker compose --profile qbittorrent up -d
```

> Cette commande démarre uniquement : `ddl-torznab`, `dlprotect-resolver` et `ddl-qbittorrent`

### Configuration de Radarr/Sonarr

#### Étape 1 : Ajouter l'indexeur Torznab

1. Aller dans **Settings > Indexers > Add**
2. Choisir **Torznab**
3. Configurer :
   - **Name** : DDL Wawacity (ou autre)
   - **URL** : `http://<IP>:9117`
   - **API Path** : `/api/wawacity` ou `/api/zonetelecharger` ou `/api/darkiworld_premium` ou `/api/bookys`
   - **API Key** : `ddl-torznab` (n'importe quelle valeur)
   - **Categories** : 2000, 2040, 2045 (Radarr) ou 5000, 5040, 5045 (Sonarr)
4. Cliquer sur **Test** puis **Save**

> **Filtrer par hébergeur** : Ajouter l'hébergeur dans l'API Path, ex: `/api/wawacity/1fichier` ou `/api/wawacity/1fichier,uptobox`

#### Étape 2 : Configurer DDL-qBittorrent comme Download Client

1. Aller dans **Settings > Download Clients > Add**
2. Choisir **qBittorrent**
3. Configurer :
   - **Name** : DDL-qBittorrent
   - **Host** : `<IP>` (IP du serveur ddl-qbittorrent)
   - **Port** : `8080` (ou votre valeur de `QBITTORRENT_PORT`)
   - **Username** : `admin` (ou votre valeur de `QB_USERNAME`)
   - **Password** : `adminadmin` (ou votre valeur de `QB_PASSWORD`)
   - **Category** : `radarr` ou `sonarr` (optionnel)
   - **Minimum Seeders** : `1`
   - **Seed Ratio** : `1`
   - **Seed Time** : `1`
4. Cliquer sur **Test** puis **Save**

> **Note sur les critères de seed** : DDL-qBittorrent renvoie des valeurs de ratio et temps de seed supérieures aux minimums configurés, ce qui permet à Radarr/Sonarr de supprimer automatiquement les téléchargements terminés.

> **Mappages de chemins distants** : Si Sonarr/Radarr et ddl-qbittorrent ne partagent pas le même système de fichiers, configurez les "Remote Path Mappings" dans Settings > Download Clients. Par exemple, si ddl-qbittorrent télécharge dans `/downloads` mais que Sonarr voit ce dossier comme `/mnt/downloads`, ajoutez un mapping : Host=`<IP ddl-qbittorrent>`, Remote Path=`/downloads`, Local Path=`/mnt/downloads`.

> **Interface Web** : Accessible sur `http://<IP>:<QBITTORRENT_PORT>/` pour voir l'état des téléchargements (port 8080 par défaut)

### Variables d'environnement DDL-qBittorrent

| Variable | Description | Défaut |
|----------|-------------|--------|
| `QBITTORRENT_PORT` | Port du service | 8080 |
| `QB_USERNAME` | Nom d'utilisateur | admin |
| `QB_PASSWORD` | Mot de passe | adminadmin |
| `DOWNLOAD_PATH` | Dossier de destination des téléchargements | /downloads |
| `TEMP_PATH` | Dossier temporaire pour les téléchargements en cours | /downloads-temp |
| `MAX_CONCURRENT_DOWNLOADS` | Nombre de téléchargements simultanés | 3 |
| `AUTO_EXTRACT_ARCHIVE` | Extraire automatiquement les archives (zip, rar, 7z) | 1 (activé) |
| `AUTO_REMOVE_COMPLETED_AFTER` | Supprimer les téléchargements terminés après X minutes (0 = désactivé) | 0 |
| `ALLDEBRID_ENABLED` | Activer AllDebrid | false |
| `ALLDEBRID_API_KEY` | Clé API AllDebrid | - |
| `REALDEBRID_ENABLED` | Activer RealDebrid | false |
| `REALDEBRID_API_KEY` | Clé API RealDebrid | - |
| `PREMIUMIZE_ENABLED` | Activer Premiumize | false |
| `PREMIUMIZE_API_KEY` | Clé API Premiumize | - |
| `DEBRID_TORRENT_TIMEOUT` | Timeout pour le debrid de vrais torrents (heures) | 24 |

### Support des vrais torrents

DDL-qBittorrent detecte automatiquement le type de torrent recu :
- **Fake torrent DDL** (cree par ddl-torznab) : Le lien DDL est extrait et debride normalement
- **Vrai torrent** : Le fichier .torrent est envoye au service de debrid qui le telecharge

#### Comment ca marche

1. Sonarr/Radarr envoie un fichier .torrent a ddl-qbittorrent
2. DDL-qBittorrent analyse le torrent :
   - Si `created by: DDL-Torznab` → traitement DDL classique
   - Sinon → envoi au service de debrid
3. Pour les vrais torrents :
   - Upload du .torrent vers AllDebrid/RealDebrid/Premiumize
   - Attente que le debrid telecharge le torrent (peut prendre du temps si pas en cache)
   - Telechargement des fichiers depuis le debrid

#### Messages de statut

- `Uploading torrent to debrid...` - Envoi du torrent au service
- `Queued on AllDebrid...` - En attente dans la file du debrid
- `Downloading on debrid: 45%` - Le debrid telecharge le torrent
- `Downloading from debrid...` - Telechargement des fichiers depuis le debrid

> **Note** : Les vrais torrents non caches peuvent prendre du temps (le debrid doit telecharger depuis les seeders). Le timeout par defaut est de 24 heures.

### Flux de téléchargement (Option A)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│ Radarr/     │────>│ ddl-torznab  │────>│ Site DDL        │
│ Sonarr      │     │ (recherche)  │     │ (wawacity, etc) │
└─────────────┘     └──────────────┘     └─────────────────┘
       │
       │ envoie .torrent via API qBittorrent
       ▼
┌─────────────────┐     ┌───────────────────┐
│ ddl-qbittorrent │────>│ dlprotect-resolver│
│ (télécharge)    │     │ (si lien protégé) │
└─────────────────┘     └───────────────────┘
       │
       │ télécharge via debrid (AllDebrid/RealDebrid)
       ▼
┌─────────────────┐
│ Downloads       │ ← Radarr/Sonarr importe automatiquement
│ folder          │
└─────────────────┘
```

---

## Configuration avec Blackhole (Option B)

### Lancer les services

```bash
docker compose --profile blackhole up -d
```

> Cette commande démarre uniquement : `ddl-torznab`, `dlprotect-resolver` et `ddl-downloader`

### Configuration de Radarr

#### Étape 1 : Ajouter l'indexeur Torznab

1. Aller dans **Settings > Indexers > Add**
2. Choisir **Torznab**
3. Configurer :
   - **Name** : DDL Wawacity (ou autre)
   - **URL** : `http://<IP>:9117`
   - **API Path** : `/api/wawacity` ou `/api/zonetelecharger` ou `/api/darkiworld_premium` ou `/api/bookys`
   - **API Key** : `ddl-torznab` (n'importe quelle valeur)
   - **Categories** : 2000, 2040, 2045
4. Cliquer sur **Test** puis **Save**

> Remplacer `<IP>` par l'adresse du serveur (ex: `192.168.1.100`, `localhost`, ou votre domaine)
> **Filtrer par hébergeur** : Ajouter l'hébergeur dans l'API Path, ex: `/api/wawacity/1fichier`

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
   - **Name** : DDL Wawacity (ou autre)
   - **URL** : `http://<IP>:9117`
   - **API Path** : `/api/wawacity` ou `/api/zonetelecharger` ou `/api/darkiworld_premium` ou `/api/bookys`
   - **API Key** : `ddl-torznab` (n'importe quelle valeur)
   - **Categories** : 5000, 5040, 5045
   - **Anime Categories** : 5070 (optionnel)
4. Cliquer sur **Test** puis **Save**

> Remplacer `<IP>` par l'adresse du serveur (ex: `192.168.1.100`, `localhost`, ou votre domaine)
> **Filtrer par hébergeur** : Ajouter l'hébergeur dans l'API Path, ex: `/api/wawacity/1fichier`

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

| Site | URL | API Path | Catégories |
|------|-----|----------|-----------|
| Wawacity | `http://<IP>:9117` | `/api/wawacity` | Films, Séries, Anime |
| ZoneTelecharger | `http://<IP>:9117` | `/api/zonetelecharger` | Films, Séries, Anime |
| Darkiworld Premium | `http://<IP>:9117` | `/api/darkiworld_premium` | Films, Séries |
| Bookys | `http://<IP>:9117` | `/api/bookys` | Ebooks (journaux, magazines) |
| Loadix | `http://<IP>:9117` | `/api/loadix` | Films, Séries, Anime |

> Remplacer `<IP>` par l'adresse du serveur (ex: `192.168.1.100`, `localhost`, ou votre domaine)

### FlareSolverr (optionnel)

FlareSolverr est un proxy qui permet de contourner la protection Cloudflare. Il est utilisé en fallback automatique quand un site retourne une erreur 403/503.

**Requis pour Bookys si le site est protégé par Cloudflare.**

**Lancer avec FlareSolverr :**
```bash
docker compose --profile qbittorrent --profile flaresolverr up -d
```

**Configuration :**
```bash
# Dans .env
FLARESOLVERR_URL=http://flaresolverr:8191
# Temps max (ms) accordé à FlareSolverr pour résoudre un challenge (défaut : 120000)
# FLARESOLVERR_TIMEOUT=120000
# Nombre d'essais par page si FlareSolverr échoue ou renvoie une page incomplète (défaut : 3)
# FLARESOLVERR_RETRIES=3
```

> FlareSolverr tourne sur le port `8191` (non exposé par défaut, interne au réseau Docker).

> Une fois un challenge résolu, l'indexeur réutilise le cookie Cloudflare (`cf_clearance`) et le User-Agent obtenus pour les pages suivantes du même site, sans repasser par FlareSolverr. Les requêtes envoyées à FlareSolverr le sont une par une, car il gère mal les requêtes simultanées.

### Intégration Prowlarr

Pour une intégration simplifiée avec Prowlarr, une définition Cardigann custom est disponible.
Voir [prowlarr/README.md](prowlarr/README.md) pour les instructions d'installation.

### Filtrage par hébergeur

Vous pouvez filtrer les résultats pour n'afficher que les liens d'un ou plusieurs hébergeurs spécifiques. Cela permet de ne garder que les hébergeurs supportés par votre service debrid.

**Via le chemin URL :**
```
http://<IP>:9117/api/wawacity/1fichier/
http://<IP>:9117/api/wawacity/1fichier,rapidgator/
http://<IP>:9117/api/zonetelecharger/turbobit/
```

**Via le paramètre query :**
```
http://<IP>:9117/api/wawacity/?hoster=1fichier
http://<IP>:9117/api/wawacity/?hoster=1fichier,rapidgator
```

**Hébergeurs courants :**
- `1fichier`
- `turbobit`
- `rapidgator`
- `uptobox`
- `nitroflare`

> **Astuce** : Dans Radarr/Sonarr, créez plusieurs indexeurs avec différents hébergeurs pour prioriser certains services. Par exemple, un indexeur `DDL Wawacity - 1fichier` et un autre `DDL Wawacity - turbobit`.

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
| `WAWACITY_URL` | URL de WawaCity (auto-détection si vide) | auto |
| `ZONETELECHARGER_URL` | URL de Zone-Téléchargement (auto-détection si vide) | auto |
| `BOOKYS_URL` | URL de Bookys | - |
| `BOOKYS_HOSTER` | Hébergeurs gardés pour Bookys (séparés par des virgules) | 1fichier |
| `LOADIX_URL` | URL de Loadix (vide = indexeur désactivé) | - |
| `LOADIX_MNEMONIC` | Phrase BIP39 du compte Loadix (connexion automatique via le résolveur) | - |
| `LOADIX_EMAIL` / `LOADIX_PASSWORD` | Alternative à la phrase BIP39 : identifiants email | - |
| `LOADIX_REFRESH_COOKIE` | Repli sans résolveur : cookie de refresh copié du navigateur | - |
| `LOADIX_RESOLVE_AT` | Où révéler les liens Loadix (`indexer` ou `downloader`) | downloader |
| `FLARESOLVERR_URL` | URL du service FlareSolverr (optionnel) | - |
| `FLARESOLVERR_TIMEOUT` | Temps max (ms) pour résoudre un challenge Cloudflare | 120000 |
| `FLARESOLVERR_RETRIES` | Nombre d'essais par page via FlareSolverr | 3 |
| `WAWACITY_MASTODON` | Profil Mastodon WawaCity pour auto-détection | https://mamot.fr/@wawacity |
| `ZONETELECHARGER_MASTODON` | Profil Mastodon ZT pour auto-détection | https://mamot.fr/@ZT |
| `BLACKHOLE_PATH` | Dossier blackhole | - |
| `ALLDEBRID_API_KEY` | Clé API AllDebrid | - |
| `DLPROTECT_RESOLVE_AT` | Où résoudre les liens dl-protect (voir ci-dessous) | indexer |
| `SEARCH_MAX_PAGES` | Nombre max de pages à crawler par recherche | 5 |
| `DISABLE_REMOTE_DL_PROTECT_CACHE` | Désactiver le cache distant pour dl-protect | false |
| `DEBUG` | Mode debug (voir ci-dessous) | false |
| `DS_ENABLED` | Activer Download Station | false |
| `JD_ENABLED` | Activer JDownloader | false |
| `ARIA2_ENABLED` | Activer aria2 | false |

> Les URLs des sites sont auto-détectées depuis Mastodon au démarrage, puis revérifiées à chaque recherche, si elles ne sont pas configurées. Vous pouvez forcer une URL en la définissant explicitement.

### Résolution des liens dl-protect

La variable `DLPROTECT_RESOLVE_AT` contrôle à quel moment les liens dl-protect sont résolus :

| Valeur | Description |
|--------|-------------|
| `indexer` | Les liens sont résolus lors de la recherche. Navigation plus rapide dans Radarr/Sonarr car les liens sont déjà prêts. |
| `downloader` | Les liens sont résolus uniquement au moment du téléchargement. Moins de charge sur le service de résolution. |

```bash
# Dans .env
DLPROTECT_RESOLVE_AT=downloader
```

### Mode Debug

Par défaut (`DEBUG=false`), les fichiers `.torrent` sont **supprimés** après traitement.

En mode debug (`DEBUG=true`), les fichiers sont **déplacés** vers le dossier `processed/` pour inspection.

```bash
# Dans .env
DEBUG=true
```

### Recherche intelligente via IMDB

Quand Radarr/Sonarr fournit un IMDB ID, l'indexeur résout :
- Le **titre original** du film/série
- Le **titre français**

Ces titres sont utilisés en plus de la requête originale pour une recherche plus complète, notamment pour les films français avec des accents. Les résultats sont mis en cache dans `imdb-titles.json` (les titres ne changent pas).

**Exemple :**
```
Radarr envoie: imdbid=0944947
→ Résolution: originalTitle="Game of Thrones", frenchTitle="Le Trône de fer"
→ Recherches effectuées: ["game of thrones", "le trône de fer"]
```

**Sources de titres**

| Source | Clé API | Quand |
|---|---|---|
| [Wikidata](https://query.wikidata.org/) | non | Par défaut, aucune configuration requise |
| [TMDB](https://www.themoviedb.org/) | oui | Utilisée en priorité si `TMDB_API_KEY` est défini |

Wikidata suffit dans la grande majorité des cas. Définir une clé TMDB (gratuite) améliore la couverture, surtout sur les titres récents ou peu connus ; si TMDB ne répond pas, Wikidata prend le relais automatiquement.

```bash
# Dans .env (optionnel)
TMDB_API_KEY=votre_cle
```

> **Note :** l'ancienne source `api.imdbapi.dev` a été abandonnée (domaine parké, plus aucun enregistrement DNS). Si vous voyez des erreurs `ENOTFOUND api.imdbapi.dev`, mettez à jour vers une version incluant ce changement.

### Cache distant dl-protect

Le service de résolution dl-protect utilise un cache distant partagé entre utilisateurs. Cela permet d'éviter de résoudre plusieurs fois le même lien.

Pour désactiver le cache distant (par exemple si le serveur est inaccessible) :

```bash
# Dans .env
DISABLE_REMOTE_DL_PROTECT_CACHE=true
```

> Le cache local reste actif même si le cache distant est désactivé.

### Loadix

[Loadix](https://loadix.fun) n'est pas scrapé en HTML : c'est une application React qui s'appuie sur une API JSON (`https://api.loadix.fun`). La recherche dans le catalogue est publique, mais **révéler un lien de téléchargement exige une session authentifiée**, et toutes les méthodes de connexion du site (email, phrase BIP39, anonyme) sont protégées par un challenge Cloudflare Turnstile. La connexion est donc confiée au service `dlprotect-resolver`, qui pilote un vrai navigateur : il obtient le jeton Turnstile sur `loadix.fun`, puis se connecte à l'API avec les identifiants configurés et renvoie la session (jeton d'accès + cookie de refresh) au service qui la demande.

**Connexion par phrase BIP39 (recommandée)**

Loadix propose des comptes identifiés par une phrase de récupération BIP39 (12 ou 24 mots) : aucun email, aucun mot de passe. Le résolveur dérive la clé secp256k1 de la phrase et signe le challenge de l'API, exactement comme le fait le site. Il est conseillé d'utiliser un compte dédié.

1. Générer une phrase sur Loadix (inscription → phrase de récupération) ou avec n'importe quel outil BIP39
2. La renseigner dans `LOADIX_MNEMONIC`. Si la phrase n'a jamais servi sur Loadix, le compte est créé au premier login (Loadix lui attribue un nom par défaut)
3. Renseigner `LOADIX_URL=https://loadix.fun` pour activer l'indexeur

```bash
# Dans .env
LOADIX_URL=https://loadix.fun
LOADIX_MNEMONIC=mot1 mot2 mot3 ... mot12
```

**Connexion par email** : renseigner `LOADIX_EMAIL` et `LOADIX_PASSWORD` à la place de la phrase.

**Repli sans résolveur** : copier le cookie de refresh d'une session ouverte dans le navigateur (DevTools → *Application* → *Cookies* → `https://api.loadix.fun`) sous la forme `nom=valeur` dans `LOADIX_REFRESH_COOKIE`. Le cookie est échangé contre des jetons d'accès de courte durée (`POST /api/auth/refresh`), renouvelés automatiquement ; s'il expire, les services repassent par le login du résolveur quand il est configuré, sinon les téléchargements Loadix échouent avec un message explicite.

Les identifiants ne quittent pas le réseau Docker : seul `dlprotect-resolver` les lit, les autres services ne reçoivent que la session. La connexion n'a lieu qu'au premier téléchargement (la recherche est publique), puis seulement si la session est révoquée.

L'API exige en plus un jeton Turnstile **à chaque révélation de lien** pour les comptes ordinaires (seuls les modérateurs en sont dispensés). Le résolveur fournit ce jeton (`POST /loadix/turnstile`) en résolvant le challenge dans son navigateur, ce qui prend 10 à 30 secondes par lien : c'est la raison pour laquelle la révélation se fait par défaut au moment du téléchargement.

Les résultats de recherche contiennent un lien opaque (`https://api.loadix.fun/api/links/<id>/reveal`) qui est transformé en lien hébergeur :

| `LOADIX_RESOLVE_AT` | Description |
|---------------------|-------------|
| `downloader` (défaut) | Le lien est révélé par DDL-qBittorrent ou le downloader blackhole au moment du téléchargement. Un seul appel par fichier réellement téléchargé. |
| `indexer` | Le lien est révélé pendant la recherche. Chaque résultat coûte un appel authentifié et un challenge Turnstile résolu par le navigateur du résolveur : très lent, gonfle les compteurs de clics du site et peut déclencher sa limite de débit. À éviter. |

Seuls les liens DDL validés sont remontés (les NZB sont ignorés). Le filtre par hébergeur fonctionne comme pour les autres sites : `/api/loadix/1fichier`.

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
| Books | 7000 | Ebooks (Bookys) |
| Books/Mags | 7010 | Magazines |
| Books/EBook | 7020 | Ebooks |
| Books/Comics | 7030 | Comics |
| Books/Technical | 7050 | Technique |

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

### Les identifiants Darkiworld sont perdus au redémarrage

Les identifiants saisis via l'interface web sont automatiquement sauvegardés sur disque et restaurés au redémarrage du conteneur. Si ce n'est pas le cas, vérifiez que le volume de configuration est bien monté :

- **docker-compose.yml** : `${DARKIWORLD_CONFIG_PATH:-./darkiworld-config}:/app/config`
- **docker-compose.prod.yml** : volume nommé `darkiworld-config:/app/config`

> **Note** : La session (cookies) n'est pas persistée — le service se ré-authentifiera automatiquement au redémarrage avec les identifiants sauvegardés.

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

### Tests et intégration continue

Chaque service Node a une suite de tests unitaires (vitest) dans son dossier `test/`, et le résolveur une suite pytest dans `botasaurus-service/tests/` (le navigateur y est remplacé par des stubs, aucun Chrome requis).

```bash
# Un service Node (indexer, qbittorrent ou downloader)
cd indexer
npm run typecheck
npm test

# Résolveur
cd botasaurus-service
pip install -r requirements-test.txt
python -m pytest tests
```

Le workflow GitHub Actions `CI` (`.github/workflows/ci.yml`) rejoue tout cela sur chaque pull request et sur chaque push de `main` : typecheck et tests des trois services Node, build de l'interface qBittorrent, tests du résolveur et validation des fichiers `docker-compose`. Une PR qui casse l'un de ces points est signalée avant relecture.

Les tests Node couvrent aussi les scrapers (pages HTML et réponses API simulées), les routes Torznab et l'API qBittorrent telle que Radarr et Sonarr l'appellent. Dependabot (`.github/dependabot.yml`) ouvre chaque semaine des PR de mise à jour des dépendances npm, pip et des actions GitHub, qui passent par la même CI.

## Licence

MIT
