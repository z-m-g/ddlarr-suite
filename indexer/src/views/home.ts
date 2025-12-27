import { getAvailableSites } from '../scrapers/index.js';
import { isDlprotectServiceConfigured } from '../config.js';

const APP_CONFIGS = {
  radarr: {
    name: 'Radarr',
    description: 'Films',
    categories: [
      { id: 2000, name: 'Films' },
      { id: 2040, name: 'Films HD' },
      { id: 2045, name: 'Films 4K' },
    ],
  },
  sonarr: {
    name: 'Sonarr',
    description: 'Séries',
    categories: [
      { id: 5000, name: 'Séries' },
      { id: 5040, name: 'Séries HD' },
      { id: 5045, name: 'Séries 4K' },
    ],
  },
  anime: {
    name: 'Sonarr (Anime)',
    description: 'Anime - utiliser le champ "Anime Categories"',
    categories: [
      { id: 5070, name: 'Anime' },
    ],
  },
};

export function renderHomePage(host: string): string {
  const sites = getAvailableSites();
  const dlprotectServiceEnabled = isDlprotectServiceConfigured();

  const appSections = sites.length > 0
    ? Object.entries(APP_CONFIGS).map(([appKey, appConfig]) =>
        generateAppSection(appKey, appConfig, sites, host)
      ).join('')
    : `<div class="empty-state">
        <p>Aucun site configuré.</p>
        <p class="hint">Ajoutez au moins une variable d'environnement :</p>
        <code>WAWACITY_URL</code>
        <code>ZONETELECHARGER_URL</code>
        <code>DARKIWORLD_URL</code>
      </div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DDL Torznab</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='12' fill='%23374151'/><text x='50' y='65' font-size='40' font-family='system-ui' font-weight='600' fill='%23f3f4f6' text-anchor='middle'>DT</text></svg>">
  <style>
    :root {
      --bg: #111827;
      --surface: #1f2937;
      --border: #374151;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 900px; margin: 0 auto; }

    header { margin-bottom: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
    .subtitle { color: var(--text-muted); font-size: 0.875rem; }

    .status-bar {
      display: flex;
      gap: 1.5rem;
      margin-top: 1rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .status-bar span { display: flex; align-items: center; gap: 0.375rem; }
    .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--border);
    }
    .dot.on { background: var(--success); }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .card h2 {
      font-size: 1rem;
      font-weight: 500;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }

    .field { margin-bottom: 1rem; }
    .field:last-child { margin-bottom: 0; }
    .field label {
      display: block;
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-bottom: 0.375rem;
      text-transform: uppercase;
      letter-spacing: 0.025em;
    }
    .field-row { display: flex; gap: 0.5rem; }

    input[type="text"] {
      flex: 1;
      padding: 0.5rem 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: ui-monospace, monospace;
      font-size: 0.8125rem;
    }
    input[type="text"]:focus { outline: none; border-color: var(--accent); }

    .btn {
      padding: 0.5rem 0.875rem;
      background: var(--accent);
      border: none;
      border-radius: 4px;
      color: white;
      font-size: 0.8125rem;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover { background: var(--accent-hover); }
    .btn.copied { background: var(--success); }

    .card-desc {
      color: var(--text-muted);
      font-size: 0.8125rem;
      margin-bottom: 1rem;
    }

    .field-hint {
      margin-top: 0.375rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .select {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-size: 0.8125rem;
      cursor: pointer;
    }
    .select:focus { outline: none; border-color: var(--accent); }

    .cat-grid { display: flex; flex-wrap: wrap; gap: 0.375rem; }
    .cat-checkbox { display: none; }
    .cat-label {
      padding: 0.375rem 0.625rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 0.75rem;
      cursor: pointer;
      transition: all 0.15s;
      user-select: none;
    }
    .cat-label:hover { border-color: var(--text-muted); }
    .cat-checkbox:checked + .cat-label {
      background: var(--accent);
      border-color: var(--accent);
      color: white;
    }

    .help {
      font-size: 0.8125rem;
      color: var(--text-muted);
    }
    .help h2 {
      font-size: 0.875rem;
      color: var(--text);
      font-weight: 500;
      margin-bottom: 0.75rem;
      padding-bottom: 0;
      border-bottom: none;
    }
    .help ol {
      margin-left: 1.25rem;
      line-height: 1.75;
    }
    .help code {
      background: var(--bg);
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
      font-size: 0.75rem;
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
    }
    .empty-state .hint { margin: 0.5rem 0; }
    .empty-state code {
      display: block;
      margin: 0.25rem 0;
      background: var(--bg);
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
      font-size: 0.8125rem;
    }

    footer {
      text-align: center;
      margin-top: 2rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    footer a { color: var(--text-muted); }
    footer a:hover { color: var(--text); }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>DDL Torznab</h1>
      <p class="subtitle">Indexeur Torznab pour Sonarr / Radarr</p>
      <div class="status-bar">
        <span><span class="dot ${sites.length > 0 ? 'on' : ''}"></span>${sites.length} site(s)</span>
        <span><span class="dot ${dlprotectServiceEnabled ? 'on' : ''}"></span>DL-Protect</span>
      </div>
    </header>

    ${appSections}

    <div class="card help">
      <h2>Configuration</h2>
      <ol>
        <li>Settings → Indexers → Add (bouton +)</li>
        <li>Choisir <strong>Torznab</strong> (Custom)</li>
        <li>Coller l'URL de base du site choisi</li>
        <li>Coller les catégories dans le champ correspondant</li>
        <li>Pour l'anime, utiliser le champ <strong>Anime Categories</strong> dans Sonarr</li>
        <li>Laisser API Key vide</li>
      </ol>
    </div>

    <div class="card help">
      <h2>Filtre par hébergeur</h2>
      <p>Ajouter l'hébergeur dans le chemin de l'URL : <code>/api/{site}/{hosters}</code></p>
      <p style="margin-top: 0.5rem;"><strong>Exemples d'URLs :</strong></p>
      <ul style="margin-left: 1.25rem; margin-top: 0.5rem; line-height: 1.75;">
        <li><code>/api/wawacity/1fichier</code> - uniquement 1fichier</li>
        <li><code>/api/zonetelecharger/turbobit</code> - uniquement Turbobit</li>
        <li><code>/api/wawacity/1fichier,rapidgator</code> - 1fichier ou Rapidgator</li>
      </ul>
      <p style="margin-top: 0.75rem;">Hébergeurs courants : <code>1fichier</code>, <code>turbobit</code>, <code>rapidgator</code>, <code>uptobox</code>, <code>nitroflare</code></p>
    </div>

    <footer>
      <a href="https://github.com/Dyhlio/wastream" target="_blank">Basé sur wastream</a>
    </footer>
  </div>

  <script>
    function updateUrl(appKey) {
      const siteSelect = document.getElementById('site-' + appKey);
      const baseUrl = siteSelect.value;
      const checked = document.querySelectorAll('.cat-' + appKey + ':checked');
      const ids = Array.from(checked).map(cb => cb.value);
      document.getElementById('url-' + appKey).value = baseUrl;
      document.getElementById('cats-' + appKey).value = ids.join(',');
    }

    function copy(inputId, btnId) {
      const input = document.getElementById(inputId);
      const btn = document.getElementById(btnId);

      input.select();
      input.setSelectionRange(0, 99999);

      try {
        document.execCommand('copy');
        btn.textContent = 'Copié';
        btn.classList.add('copied');
        setTimeout(() => {
          btn.textContent = 'Copier';
          btn.classList.remove('copied');
        }, 1500);
      } catch (e) {
        btn.textContent = 'Erreur';
      }
    }
  </script>
</body>
</html>`;
}

interface AppConfig {
  name: string;
  description: string;
  categories: Array<{ id: number; name: string }>;
}

function generateAppSection(appKey: string, appConfig: AppConfig, sites: string[], host: string): string {
  const searchType = appKey === 'radarr' ? 'movie' : 'tvsearch';
  const testExample = appKey === 'radarr'
    ? '?t=movie&cat=2000&q=Movie+Title'
    : '?t=tvsearch&cat=5000&q=Show+Title&season=1&ep=2';

  const categoryCheckboxes = appConfig.categories.map(cat => `
    <span>
      <input type="checkbox" class="cat-checkbox cat-${appKey}" id="cat-${appKey}-${cat.id}"
             value="${cat.id}" onchange="updateUrl('${appKey}')" checked>
      <label class="cat-label" for="cat-${appKey}-${cat.id}">${cat.id} ${cat.name}</label>
    </span>
  `).join('');

  const siteOptions = sites.map((site, i) =>
    `<option value="${host}/api/${site}" data-type="${searchType}" ${i === 0 ? 'selected' : ''}>${getSiteName(site)}</option>`
  ).join('');

  const defaultUrl = `${host}/api/${sites[0]}`;
  const defaultCats = appConfig.categories.map(c => c.id).join(',');

  return `
    <div class="card">
      <h2>${appConfig.name}</h2>
      <p class="card-desc">${appConfig.description}</p>

      <div class="field">
        <label>Site</label>
        <select id="site-${appKey}" class="select" data-type="${searchType}" onchange="updateUrl('${appKey}')">
          ${siteOptions}
        </select>
      </div>

      <div class="field">
        <label>${appKey === 'anime' ? 'Anime Categories' : 'Categories'}</label>
        <div class="cat-grid">${categoryCheckboxes}</div>
      </div>

      <div class="field">
        <label>URL de base</label>
        <div class="field-row">
          <input type="text" id="url-${appKey}" value="${defaultUrl}" readonly>
          <button class="btn" id="btn-${appKey}" onclick="copy('url-${appKey}', 'btn-${appKey}')">Copier</button>
        </div>
      </div>

      <div class="field">
        <label>Categories</label>
        <div class="field-row">
          <input type="text" id="cats-${appKey}" value="${defaultCats}" readonly>
          <button class="btn" id="btn-cats-${appKey}" onclick="copy('cats-${appKey}', 'btn-cats-${appKey}')">Copier</button>
        </div>
      </div>

      <p class="field-hint">Test : <code>${defaultUrl}${testExample}</code></p>
    </div>
  `;
}

function getSiteName(site: string): string {
  const names: Record<string, string> = {
    wawacity: 'WawaCity',
    zonetelecharger: 'Zone-Téléchargement',
    darkiworld: 'DarkiWorld',
  };
  return names[site] || site;
}
