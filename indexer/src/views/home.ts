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
  readarr: {
    name: 'Readarr',
    description: 'Ebooks & Livres',
    categories: [
      { id: 7000, name: 'Books' },
      { id: 7010, name: 'Magazines' },
      { id: 7020, name: 'EBook' },
      { id: 7030, name: 'Comics' },
      { id: 7050, name: 'Other' },
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

    input[type="text"],
    input[type="password"] {
      flex: 1;
      padding: 0.5rem 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      color: var(--text);
      font-family: ui-monospace, monospace;
      font-size: 0.8125rem;
      min-width: 40%;
    }
    input[type="text"]:focus,
    input[type="password"]:focus { outline: none; border-color: var(--accent); }

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

    /* Darkiworld config styles */
    .toggle-label {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      cursor: pointer;
    }
    .toggle-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin: 0;
      accent-color: var(--accent);
      cursor: pointer;
      flex-shrink: 0;
    }
    .toggle-text { 
      font-size: 0.875rem; 
      flex: 1;
      text-transform: none; /* Ensure no uppercase */
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.2rem 0.6rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      margin-left: 0.75rem;
      text-transform: none; /* Ensure no uppercase */
    }
    .status-badge.authenticated {
      background: rgba(16, 185, 129, 0.2);
      color: var(--success);
    }
    .status-badge.not-authenticated {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
    }
    .status-badge.disabled {
      background: rgba(156, 163, 175, 0.2);
      color: var(--text-muted);
    }
    .status-badge.loading {
      background: rgba(59, 130, 246, 0.2);
      color: var(--accent);
    }
    .save-status {
      margin-left: 0.75rem;
      font-size: 0.8125rem;
    }
    .save-status.success { color: var(--success); }
    .save-status.error { color: #ef4444; }
    #darkiworld-fields {
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
    .btn-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .btn-secondary {
      background: var(--border);
    }
    .btn-secondary:hover {
      background: var(--text-muted);
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .prerequisites {
      padding-left: 0;
      font-size: 0.8125rem;
      color: var(--text-muted);
      list-style: none;
      margin: 0.5rem 0;
    }
    .prerequisites li {
      margin-bottom: 0.35rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .prerequisites li::before {
      content: '•';
      color: var(--accent);
      font-weight: bold;
    }
    .prereq-box {
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.25);
      border-radius: 6px;
      padding: 0.75rem 1rem;
      margin: 0.75rem 0;
    }
    .prereq-box .prereq-title {
      font-size: 0.6875rem;
      text-transform: uppercase;
      color: var(--accent);
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
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

    <div class="card" id="darkiworld-config-card">
      <h2 style="display: flex; align-items: center;">
        DarkiWorld Premium
        <span class="status-badge" id="darkiworld-status">--</span>
      </h2>

      <div class="field">
        <label class="toggle-label">
          <input type="checkbox" id="darkiworld-enabled" onchange="updateDarkiworldStatus()">
          <span class="toggle-text">Activer l'indexeur</span>
        </label>
      </div>

      <div class="prereq-box">
        <div class="prereq-title">Pré-requis</div>
        <ul class="prerequisites">
          <li>Compte Premium sur Darkiworld</li>
          <li>Clé API AllDebrid configurée dans .env</li>
        </ul>
      </div>
      
      <div id="darkiworld-fields">
        <div class="field">
          <label>Email</label>
          <input type="text" id="darkiworld-email" placeholder="email@example.com">
        </div>
        
        <div class="field">
          <label>Mot de passe</label>
          <input type="password" id="darkiworld-password" placeholder="Laisser vide pour ne pas modifier">
        </div>
        
        <div class="field btn-row">
          <button class="btn" id="darkiworld-save-btn" onclick="saveDarkiworldConfig()">Enregistrer</button>
          <button class="btn btn-secondary" id="darkiworld-test-btn" onclick="testDarkiworldLogin()">Tester la connexion</button>
          <span class="save-status" id="darkiworld-save-status"></span>
        </div>
      </div>
    </div>

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
        <li><code>/api/darkiworld-premium/1fichier</code> - uniquement 1fichier sur DarkiWorld</li>
        <li><code>/api/loadix/1fichier</code> - uniquement 1fichier sur Loadix</li>
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

    // Darkiworld config functions
    let darkiworldConfig = null;

    async function loadDarkiworldConfig() {
      const statusBadge = document.getElementById('darkiworld-status');
      statusBadge.textContent = 'Chargement...';
      statusBadge.className = 'status-badge loading';

      try {
        const response = await fetch('/darkiworld/config');
        const text = await response.text();
        
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error('Invalid JSON: ' + text.substring(0, 50));
        }
        
        darkiworldConfig = data;

        // Handle service offline (profile not active)
        if (darkiworldConfig.reason === 'SERVICE_UNAVAILABLE' || (darkiworldConfig.error && darkiworldConfig.error.includes('ENOTFOUND'))) {
          statusBadge.textContent = 'Non démarré';
          statusBadge.className = 'status-badge disabled';
          
          document.getElementById('darkiworld-enabled').disabled = true;
          document.getElementById('darkiworld-enabled').checked = false;
          
          // Show warning
          const header = statusBadge.parentNode;
          
          if (!document.getElementById('dw-offline-msg')) {
            const msg = document.createElement('div');
            msg.id = 'dw-offline-msg';
            msg.style.cssText = 'color: #ef4444; font-size: 0.8125rem; margin-bottom: 1rem; margin-top: -0.5rem;';
            msg.textContent = '⚠ Container non démarré. Relancez avec : docker compose --profile darkiworld up -d ou décommentez le profile dans le .env';
            
            // Insert after header (next sibling of h2)
            header.parentNode.insertBefore(msg, header.nextSibling);
          }
           
          // Disable fields
          const fields = document.getElementById('darkiworld-fields');
          fields.style.opacity = '0.5';
          fields.style.pointerEvents = 'none';
          return;
        }

        document.getElementById('darkiworld-enabled').checked = darkiworldConfig.enabled;
        document.getElementById('darkiworld-email').value = darkiworldConfig.email || '';
        updateDarkiworldStatus();
      } catch (error) {
        console.error('Error loading Darkiworld config:', error);
        statusBadge.textContent = 'Erreur: ' + (error.message || error).substring(0, 20);
        statusBadge.title = error.message || error;
        statusBadge.className = 'status-badge error';
      }
    }

    // Track if login test has passed in this session
    let loginTestPassed = false;

    function updateDarkiworldStatus() {
      const enabled = document.getElementById('darkiworld-enabled').checked;
      const statusBadge = document.getElementById('darkiworld-status');
      const fields = document.getElementById('darkiworld-fields');
      const saveBtn = document.getElementById('darkiworld-save-btn');

      if (!enabled) {
        statusBadge.textContent = 'Désactivé';
        statusBadge.className = 'status-badge disabled';
        fields.style.opacity = '0.5';
        fields.style.pointerEvents = 'none';
        saveBtn.disabled = false;
      } else if (darkiworldConfig && darkiworldConfig.authenticated) {
        statusBadge.textContent = 'Connecté';
        statusBadge.className = 'status-badge authenticated';
        fields.style.opacity = '1';
        fields.style.pointerEvents = 'auto';
        saveBtn.disabled = false;
        loginTestPassed = true;
      } else {
        statusBadge.textContent = 'Non connecté';
        statusBadge.className = 'status-badge not-authenticated';
        fields.style.opacity = '1';
        fields.style.pointerEvents = 'auto';
        // Disable save if trying to enable without successful login
        saveBtn.disabled = !loginTestPassed;
      }
    }

    async function saveDarkiworldConfig() {
      const btn = document.getElementById('darkiworld-save-btn');
      const status = document.getElementById('darkiworld-save-status');
      const enabled = document.getElementById('darkiworld-enabled').checked;

      // If trying to enable but login test hasn't passed, show error
      if (enabled && !loginTestPassed && !(darkiworldConfig && darkiworldConfig.authenticated)) {
        status.textContent = '✗ Veuillez tester la connexion';
        status.className = 'save-status error';
        setTimeout(() => { status.textContent = ''; }, 3000);
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Enregistrement...';
      status.textContent = '';
      status.className = 'save-status';

      const email = document.getElementById('darkiworld-email').value;
      const password = document.getElementById('darkiworld-password').value;

      const payload = { enabled, email };
      if (password) payload.password = password;

      try {
        const response = await fetch('/darkiworld/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success) {
          darkiworldConfig = result;
          document.getElementById('darkiworld-password').value = '';
          status.textContent = '✓ Enregistré';
          status.className = 'save-status success';
          updateDarkiworldStatus();
        } else {
          status.textContent = '✗ ' + (result.error || 'Erreur');
          status.className = 'save-status error';
        }
      } catch (error) {
        status.textContent = '✗ Erreur de connexion';
        status.className = 'save-status error';
      }

      btn.disabled = false;
      btn.textContent = 'Enregistrer';

      setTimeout(() => {
        status.textContent = '';
      }, 3000);
    }

    async function testDarkiworldLogin() {
      const testBtn = document.getElementById('darkiworld-test-btn');
      const saveBtn = document.getElementById('darkiworld-save-btn');
      const status = document.getElementById('darkiworld-save-status');
      
      testBtn.disabled = true;
      saveBtn.disabled = true;
      testBtn.textContent = 'Test en cours...';
      status.textContent = '⏳ Connexion à DarkiWorld (Timeout de 60s)...';
      status.className = 'save-status';

      const email = document.getElementById('darkiworld-email').value;
      const password = document.getElementById('darkiworld-password').value;

      const payload = {};
      if (email) payload.email = email;
      if (password) payload.password = password;

      try {
        const response = await fetch('/darkiworld/test-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.success && result.authenticated) {
          loginTestPassed = true;
          darkiworldConfig = { ...darkiworldConfig, authenticated: true };
          document.getElementById('darkiworld-password').value = '';
          status.textContent = '✓ ' + result.message;
          status.className = 'save-status success';
          updateDarkiworldStatus();
        } else {
          loginTestPassed = false;
          status.textContent = '✗ ' + (result.message || 'Échec du test');
          status.className = 'save-status error';
        }
      } catch (error) {
        loginTestPassed = false;
        status.textContent = '✗ Erreur de connexion au service';
        status.className = 'save-status error';
      }

      testBtn.disabled = false;
      testBtn.textContent = 'Tester la connexion';
      // Re-enable save button based on login status
      updateDarkiworldStatus();

      setTimeout(() => {
        status.textContent = '';
      }, 5000);
    }

    // Load config on page load
    document.addEventListener('DOMContentLoaded', loadDarkiworldConfig);
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
  const searchTypeMap: Record<string, string> = {
    radarr: 'movie',
    sonarr: 'tvsearch',
    anime: 'tvsearch',
    readarr: 'book',
  };
  const searchType = searchTypeMap[appKey] || 'search';

  const testExampleMap: Record<string, string> = {
    radarr: '?t=movie&cat=2000&q=Movie+Title',
    sonarr: '?t=tvsearch&cat=5000&q=Show+Title&season=1&ep=2',
    anime: '?t=tvsearch&cat=5070&q=Anime+Title',
    readarr: '?t=book&cat=7000&q=Book+Title',
  };
  const testExample = testExampleMap[appKey] || '?t=search&q=Query';

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
    'darkiworld-premium': 'DarkiWorld Premium',
    bookys: 'Bookys',
    loadix: 'Loadix',
  };
  return names[site] || site;
}