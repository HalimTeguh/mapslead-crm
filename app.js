/* ============================================================
   MAPSLEAD CRM — app.js
   ============================================================ */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================
const STATUSES = {
  new:       { label: 'New',           cls: 's-new' },
  contacted: { label: 'Contacted',     cls: 's-contacted' },
  interested:{ label: 'Interested',    cls: 's-interested' },
  proposal:  { label: 'Proposal Sent', cls: 's-proposal' },
  won:       { label: 'Won',           cls: 's-won' },
  lost:      { label: 'Lost',          cls: 's-lost' },
};
const STORAGE_KEY = 'varadata_leads_v1';
const MAX_DETAILS_CONCURRENT = 3; // parallel Place Detail calls

// ============================================================
// STATE
// ============================================================
const state = {
  userLocation: null,
  searchResults: [],
  selectedIds: new Set(),
  addedPlaceIds: new Set(),
  isSearching: false,
  leads: [],
  crmSelectedIds: new Set(),
  editingLeadId: null,
};

// ============================================================
// INIT
// ============================================================
const VaradataApp = {
  initMaps() {
    // New Places API (google.maps.places.Place) — no service instance needed
    window._varadataReady = true;
    console.log('[Varadata] Google Maps Places ready');
    this.boot();
  },

  boot() {
    loadLeads();
    renderCRM();
    updateLeadCount();
    registerSW();

    // PWA install prompt
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      window._pwaPrompt = e;
      document.getElementById('install-btn').classList.remove('hidden');
    });

    // Handle hash-based tab switching from manifest shortcuts
    const hash = location.hash.replace('#', '');
    if (hash === 'crm') switchTab('crm');

    // Keyboard shortcut: / to focus search
    document.addEventListener('keydown', e => {
      if (e.key === '/' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        switchTab('search');
        document.getElementById('search-input').focus();
      }
    });
  }
};

// ============================================================
// TAB NAVIGATION
// ============================================================
function switchTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const panel = document.getElementById(`tab-${name}`);
  panel.classList.remove('hidden');
  panel.classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  if (name === 'crm') renderCRM();
}

// ============================================================
// SEARCH
// ============================================================
// Normalize new Places API object → internal format used throughout the app
function normalizePlace(p) {
  return {
    place_id: p.id,
    name: p.displayName || '',
    formatted_address: p.formattedAddress || '',
    rating: p.rating || null,
    user_ratings_total: p.userRatingCount || 0,
    types: p.types || [],
  };
}

async function performSearch() {
  if (!window._varadataReady) {
    showToast('Google Maps is still loading, please wait…', 'warning');
    return;
  }
  const query = document.getElementById('search-input').value.trim();
  if (!query) {
    document.getElementById('search-input').focus();
    showToast('Enter a keyword to search', 'warning');
    return;
  }
  if (state.isSearching) return;

  state.isSearching = true;
  state.searchResults = [];
  state.selectedIds.clear();

  setSearchLoading(true);
  document.getElementById('search-clear').classList.remove('hidden');

  try {
    const request = {
      textQuery: query,
      fields: ['displayName', 'formattedAddress', 'rating', 'userRatingCount', 'types', 'id'],
      maxResultCount: 20,
    };

    if (document.getElementById('use-location').checked) {
      const loc = await getUserLocation();
      request.locationBias = {
        circle: {
          center: { lat: loc.lat, lng: loc.lng },
          radius: parseInt(document.getElementById('radius-select').value),
        },
      };
    }

    const { places } = await google.maps.places.Place.searchByText(request);

    state.isSearching = false;
    setSearchLoading(false);

    if (!places || places.length === 0) {
      showResultsArea(false);
      showToast('No results found. Try a different keyword.', 'info');
      return;
    }

    state.searchResults = places.map(normalizePlace);
    showResultsArea(true);
    renderResults();
    document.getElementById('load-more-wrap').classList.add('hidden');
    document.getElementById('results-count-label').textContent =
      `${state.searchResults.length} result${state.searchResults.length !== 1 ? 's' : ''} found`;

  } catch (err) {
    console.error(err);
    setSearchLoading(false);
    state.isSearching = false;
    showToast('Search failed: ' + (err.message || err), 'error');
  }
}

function loadMore() { /* pagination not available in new Places JS API */ }

function renderResults() {
  const grid = document.getElementById('results-grid');
  // Re-render all (simpler and ensures selection state is correct)
  grid.innerHTML = state.searchResults.map((place, i) => resultCardHTML(place, i)).join('');
  updateSelectionUI();
}

function resultCardHTML(place, idx) {
  const inCRM = state.addedPlaceIds.has(place.place_id);
  const sel = state.selectedIds.has(place.place_id);
  const cats = (place.types || [])
    .filter(t => !['point_of_interest', 'establishment', 'food', 'store'].includes(t))
    .slice(0, 2)
    .map(t => t.replace(/_/g, ' '));
  const rating = place.rating ? place.rating.toFixed(1) : null;
  const reviews = place.user_ratings_total || 0;

  return `
  <div class="result-card${sel ? ' selected' : ''}${inCRM ? ' added' : ''}"
       id="rcard-${place.place_id}"
       onclick="toggleSelect('${place.place_id}')">
    <div class="result-card-header">
      <label class="result-check" onclick="event.stopPropagation()">
        <input type="checkbox" ${sel ? 'checked' : ''} onchange="toggleSelect('${place.place_id}')">
        <span class="check-box"></span>
      </label>
      <div class="result-info">
        <div class="result-name" title="${esc(place.name)}">${esc(place.name)}</div>
        ${cats.length ? `<div class="result-cats">${cats.map(c => `<span class="cat-tag">${esc(c)}</span>`).join('')}</div>` : ''}
        ${rating ? `
        <div class="result-rating">
          <span class="stars">${starStr(parseFloat(rating))}</span>
          <span class="rating-val">${rating}</span>
          <span class="reviews">(${reviews.toLocaleString()})</span>
        </div>` : '<div class="result-rating" style="color:var(--text-3);font-size:12px">No rating</div>'}
      </div>
      ${inCRM ? `<span class="added-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Added</span>` : ''}
    </div>
    ${place.formatted_address ? `
    <div class="result-address">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      ${esc(place.formatted_address)}
    </div>` : ''}
    <div class="result-actions">
      <button class="btn btn-sm btn-outline" onclick="event.stopPropagation(); quickAddToCRM('${place.place_id}', ${idx})" ${inCRM ? 'disabled' : ''}>
        ${inCRM ? '✓ In CRM' : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to CRM'}
      </button>
      <a class="btn btn-sm btn-ghost" href="https://www.google.com/maps/place/?q=place_id:${place.place_id}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Maps
      </a>
    </div>
  </div>`;
}

function toggleSelect(placeId) {
  if (state.selectedIds.has(placeId)) {
    state.selectedIds.delete(placeId);
  } else {
    state.selectedIds.add(placeId);
  }
  // Update card visual
  const card = document.getElementById(`rcard-${placeId}`);
  if (card) {
    card.classList.toggle('selected', state.selectedIds.has(placeId));
    const cb = card.querySelector('input[type="checkbox"]');
    if (cb) cb.checked = state.selectedIds.has(placeId);
  }
  updateSelectionUI();
}

function toggleSelectAll(checked) {
  state.searchResults.forEach(p => {
    if (checked) state.selectedIds.add(p.place_id);
    else state.selectedIds.delete(p.place_id);
  });
  renderResults();
  document.getElementById('select-all-check').checked = checked;
}

function updateSelectionUI() {
  const count = state.selectedIds.size;
  document.getElementById('sel-count').textContent = count;
  const btn = document.getElementById('add-selected-btn');
  btn.disabled = count === 0;

  const total = state.searchResults.length;
  const allSel = total > 0 && count === total;
  document.getElementById('select-all-check').checked = allSel;
  document.getElementById('select-all-check').indeterminate = count > 0 && !allSel;
}

async function addSelectedToCRM() {
  if (state.selectedIds.size === 0) return;
  const selectedPlaces = state.searchResults.filter(p => state.selectedIds.has(p.place_id));
  const newOnes = selectedPlaces.filter(p => !state.addedPlaceIds.has(p.place_id));

  if (newOnes.length === 0) {
    showToast('All selected leads are already in CRM', 'info');
    return;
  }

  // Add with basic info immediately
  newOnes.forEach(place => addBasicLead(place));
  saveLeads();
  updateLeadCount();
  state.selectedIds.clear();
  renderResults();
  showToast(`${newOnes.length} lead${newOnes.length > 1 ? 's' : ''} added! Fetching details…`, 'success');

  // Fetch details in batches
  await fetchDetailsBatch(newOnes);
  saveLeads();
  renderCRM();
  showToast('Contact details updated', 'success');
}

async function quickAddToCRM(placeId, idx) {
  if (state.addedPlaceIds.has(placeId)) return;
  const place = state.searchResults[idx];
  if (!place) return;

  addBasicLead(place);
  saveLeads();
  updateLeadCount();

  // Update card
  const card = document.getElementById(`rcard-${placeId}`);
  if (card) {
    card.classList.add('added');
    const addBtn = card.querySelector('.btn-outline');
    if (addBtn) { addBtn.textContent = '✓ In CRM'; addBtn.disabled = true; }
    if (!card.querySelector('.added-badge')) {
      card.querySelector('.result-card-header').insertAdjacentHTML('beforeend',
        `<span class="added-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Added</span>`);
    }
  }
  showToast(`"${place.name}" added to CRM`, 'success');

  // Fetch details
  try {
    const details = await getPlaceDetails(placeId);
    const lead = state.leads.find(l => l.placeId === placeId);
    if (lead && details) {
      lead.phone = details.formatted_phone_number || details.international_phone_number || '';
      lead.website = details.website || '';
      lead.businessStatus = details.business_status || '';
      lead.detailsFetched = true;
      saveLeads();
      renderCRM();
    }
  } catch (e) { /* non-fatal */ }
}

// ============================================================
// PLACES API HELPERS
// ============================================================
async function getPlaceDetails(placeId) {
  try {
    const place = new google.maps.places.Place({ id: placeId });
    await place.fetchFields({ fields: ['nationalPhoneNumber', 'internationalPhoneNumber', 'websiteURI', 'businessStatus'] });
    return {
      formatted_phone_number: place.nationalPhoneNumber || '',
      international_phone_number: place.internationalPhoneNumber || '',
      website: place.websiteURI || '',
      business_status: place.businessStatus || '',
    };
  } catch (e) {
    return null;
  }
}

async function fetchDetailsBatch(places) {
  for (let i = 0; i < places.length; i += MAX_DETAILS_CONCURRENT) {
    const batch = places.slice(i, i + MAX_DETAILS_CONCURRENT);
    await Promise.all(batch.map(async place => {
      try {
        const details = await getPlaceDetails(place.place_id);
        const lead = state.leads.find(l => l.placeId === place.place_id);
        if (lead && details) {
          lead.phone = details.formatted_phone_number || details.international_phone_number || '';
          lead.website = details.website || '';
          lead.businessStatus = details.business_status || '';
          lead.detailsFetched = true;
        }
      } catch (e) { /* skip */ }
    }));
    // Small delay between batches to be polite to the API
    if (i + MAX_DETAILS_CONCURRENT < places.length) await delay(300);
  }
}

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error('Location access denied'))
    );
  });
}

// ============================================================
// LEAD DATA MODEL
// ============================================================
function addBasicLead(place) {
  if (state.addedPlaceIds.has(place.place_id)) return;
  const cats = (place.types || [])
    .filter(t => !['point_of_interest', 'establishment', 'food', 'store'].includes(t))
    .map(t => t.replace(/_/g, ' '));

  const lead = {
    id: uid(),
    placeId: place.place_id,
    name: place.name || '',
    address: place.formatted_address || '',
    phone: '',
    website: '',
    email: '',
    rating: place.rating || null,
    reviewCount: place.user_ratings_total || 0,
    categories: cats,
    status: 'new',
    notes: '',
    businessStatus: '',
    detailsFetched: false,
    source: 'Google Maps',
    dateAdded: new Date().toISOString(),
    lastModified: new Date().toISOString(),
  };
  state.leads.unshift(lead);
  state.addedPlaceIds.add(place.place_id);
  return lead;
}

// ============================================================
// CRM STORAGE
// ============================================================
function loadLeads() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.leads = raw ? JSON.parse(raw) : [];
    state.addedPlaceIds = new Set(state.leads.map(l => l.placeId).filter(Boolean));
  } catch (e) {
    state.leads = [];
    state.addedPlaceIds = new Set();
  }
}

function saveLeads() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.leads));
    updateLeadCount();
  } catch (e) {
    showToast('Storage full — could not save leads', 'error');
  }
}

function updateLeadCount() {
  const badge = document.getElementById('lead-count');
  const n = state.leads.length;
  badge.textContent = n > 0 ? n : '';
  badge.toggleAttribute('data-zero', n === 0);
}

// ============================================================
// CRM RENDER
// ============================================================
function renderCRM() {
  updateStats();
  const leads = getFilteredLeads();
  const tbody = document.getElementById('crm-tbody');
  const empty = document.getElementById('crm-empty');
  const tableWrap = document.getElementById('crm-table-wrap');

  if (state.leads.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    tableWrap.querySelector('table').classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  tableWrap.querySelector('table').classList.remove('hidden');

  tbody.innerHTML = leads.map(lead => leadRowHTML(lead)).join('');
  updateCRMSelection();
}

function leadRowHTML(lead) {
  const sel = state.crmSelectedIds.has(lead.id);
  const statusOpts = Object.entries(STATUSES).map(([k, v]) =>
    `<option value="${k}" ${lead.status === k ? 'selected' : ''}>${v.label}</option>`
  ).join('');
  const statusCls = STATUSES[lead.status]?.cls || 's-new';
  const cats = (lead.categories || []).slice(0, 1).join(', ');
  const domain = lead.website ? extractDomain(lead.website) : '';

  return `
  <tr id="lrow-${lead.id}" class="${sel ? 'selected-row' : ''}">
    <td class="col-check">
      <div class="option-check" style="margin:0">
        <input type="checkbox" id="lchk-${lead.id}" ${sel ? 'checked' : ''} onchange="toggleCRMSelect('${lead.id}', this.checked)">
        <label for="lchk-${lead.id}" class="check-box" style="width:16px;height:16px"></label>
      </div>
    </td>
    <td>
      <div class="lead-name">${esc(lead.name)}</div>
      ${lead.address ? `<div class="lead-address" title="${esc(lead.address)}">${esc(lead.address)}</div>` : ''}
    </td>
    <td style="color:var(--text-2);font-size:13px;white-space:nowrap">${esc(cats || '—')}</td>
    <td class="lead-phone">
      ${lead.phone
        ? `<a href="tel:${lead.phone}" style="color:var(--text-2);text-decoration:none">${esc(lead.phone)}</a>`
        : lead.detailsFetched
          ? '<span style="color:var(--text-3);font-size:12px">—</span>'
          : `<span class="fetching-badge"><svg class="spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> fetching</span>`
      }
    </td>
    <td class="lead-website">
      ${lead.website
        ? `<a href="${lead.website}" target="_blank" rel="noopener" title="${esc(lead.website)}">${esc(domain)}</a>`
        : '<span class="no-data">—</span>'
      }
    </td>
    <td>
      ${lead.rating
        ? `<div class="lead-rating"><span class="stars">${starStr(lead.rating)}</span><span style="font-size:12px;color:var(--text-2)">${lead.rating.toFixed(1)}</span></div>`
        : '<span style="color:var(--text-3);font-size:12px">—</span>'
      }
    </td>
    <td>
      <select class="status-select ${statusCls}" onchange="updateStatus('${lead.id}', this.value)">
        ${statusOpts}
      </select>
    </td>
    <td style="color:var(--text-3);font-size:12px;white-space:nowrap">${fmtDate(lead.dateAdded)}</td>
    <td class="col-actions">
      <div class="table-actions">
        <button class="action-btn edit" title="Edit" onclick="openEditModal('${lead.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn delete" title="Delete" onclick="deleteLead('${lead.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6m4-6v6"/></svg>
        </button>
      </div>
    </td>
  </tr>`;
}

function getFilteredLeads() {
  const search = document.getElementById('crm-search')?.value.toLowerCase() || '';
  const status = document.getElementById('status-filter')?.value || '';
  const sort = document.getElementById('sort-select')?.value || 'dateAdded_desc';

  let leads = [...state.leads];

  if (search) {
    leads = leads.filter(l =>
      l.name.toLowerCase().includes(search) ||
      l.address.toLowerCase().includes(search) ||
      (l.phone || '').includes(search) ||
      (l.notes || '').toLowerCase().includes(search)
    );
  }
  if (status) leads = leads.filter(l => l.status === status);

  const [field, dir] = sort.split('_');
  leads.sort((a, b) => {
    let va = a[field], vb = b[field];
    if (field === 'dateAdded') { va = new Date(va); vb = new Date(vb); }
    if (field === 'rating') { va = va || 0; vb = vb || 0; }
    if (field === 'name') { va = va || ''; vb = vb || ''; }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  return leads;
}

function filterLeads() { renderCRM(); }

function updateStats() {
  const leads = state.leads;
  document.getElementById('stat-total').textContent = leads.length;
  document.getElementById('stat-new').textContent = leads.filter(l => l.status === 'new').length;
  document.getElementById('stat-contacted').textContent = leads.filter(l => l.status === 'contacted').length;
  document.getElementById('stat-won').textContent = leads.filter(l => l.status === 'won').length;
  document.getElementById('stat-lost').textContent = leads.filter(l => l.status === 'lost').length;
}

// ============================================================
// CRM ACTIONS
// ============================================================
function updateStatus(id, newStatus) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  lead.status = newStatus;
  lead.lastModified = new Date().toISOString();
  saveLeads();
  updateStats();
  // Re-style the select
  const row = document.getElementById(`lrow-${id}`);
  if (row) {
    const sel = row.querySelector('.status-select');
    if (sel) {
      sel.className = `status-select ${STATUSES[newStatus]?.cls || 's-new'}`;
    }
  }
}

function deleteLead(id) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  if (!confirm(`Delete "${lead.name}" from your CRM?`)) return;
  state.leads = state.leads.filter(l => l.id !== id);
  state.addedPlaceIds.delete(lead.placeId);
  state.crmSelectedIds.delete(id);
  saveLeads();
  renderCRM();
  showToast(`"${lead.name}" removed`, 'info');
}

function toggleCRMSelect(id, checked) {
  if (checked) state.crmSelectedIds.add(id);
  else state.crmSelectedIds.delete(id);
  updateCRMSelection();
  const row = document.getElementById(`lrow-${id}`);
  if (row) row.classList.toggle('selected-row', checked);
}

function toggleCRMSelectAll(checked) {
  const filtered = getFilteredLeads();
  filtered.forEach(l => {
    if (checked) state.crmSelectedIds.add(l.id);
    else state.crmSelectedIds.delete(l.id);
  });
  renderCRM();
}

function updateCRMSelection() {
  const count = state.crmSelectedIds.size;
  const btn = document.getElementById('delete-selected-btn');
  if (btn) btn.style.display = count > 0 ? 'inline-flex' : 'none';
  const allBox = document.getElementById('crm-select-all');
  if (allBox) {
    const filtered = getFilteredLeads();
    allBox.checked = filtered.length > 0 && filtered.every(l => state.crmSelectedIds.has(l.id));
    allBox.indeterminate = count > 0 && !allBox.checked;
  }
}

function deleteSelected() {
  const ids = [...state.crmSelectedIds];
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} lead${ids.length > 1 ? 's' : ''}?`)) return;
  ids.forEach(id => {
    const lead = state.leads.find(l => l.id === id);
    if (lead) state.addedPlaceIds.delete(lead.placeId);
  });
  state.leads = state.leads.filter(l => !ids.includes(l.id));
  state.crmSelectedIds.clear();
  saveLeads();
  renderCRM();
  showToast(`${ids.length} lead${ids.length > 1 ? 's' : ''} deleted`, 'info');
}

// ============================================================
// EDIT MODAL
// ============================================================
function openEditModal(id) {
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;
  state.editingLeadId = id;

  document.getElementById('modal-title').textContent = 'Edit Lead';
  document.getElementById('modal-body').innerHTML = `
    ${lead.address ? `
    <div class="modal-info-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      ${esc(lead.address)}
    </div>` : ''}
    <div class="form-grid">
      <div class="form-field full">
        <label class="form-label">Business Name</label>
        <input class="form-input" id="edit-name" value="${esc(lead.name)}" placeholder="Business name">
      </div>
      <div class="form-field">
        <label class="form-label">Phone</label>
        <input class="form-input" id="edit-phone" value="${esc(lead.phone || '')}" placeholder="+62 xxx xxxx xxxx">
      </div>
      <div class="form-field">
        <label class="form-label">Email</label>
        <input class="form-input" type="email" id="edit-email" value="${esc(lead.email || '')}" placeholder="contact@example.com">
      </div>
      <div class="form-field full">
        <label class="form-label">Website</label>
        <input class="form-input" id="edit-website" value="${esc(lead.website || '')}" placeholder="https://example.com">
      </div>
      <div class="form-field">
        <label class="form-label">Status</label>
        <select class="form-input" id="edit-status">
          ${Object.entries(STATUSES).map(([k, v]) =>
            `<option value="${k}" ${lead.status === k ? 'selected' : ''}>${v.label}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Rating</label>
        <input class="form-input" id="edit-rating" value="${lead.rating || ''}" placeholder="—" readonly>
      </div>
      <div class="form-field full">
        <label class="form-label">Notes</label>
        <textarea class="form-input" id="edit-notes" rows="4" placeholder="Add notes, follow-up reminders…">${esc(lead.notes || '')}</textarea>
      </div>
    </div>
  `;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveLeadEdit()">Save Changes</button>
  `;
  document.getElementById('lead-modal').classList.remove('hidden');
  document.getElementById('edit-name').focus();
}

function saveLeadEdit() {
  const id = state.editingLeadId;
  const lead = state.leads.find(l => l.id === id);
  if (!lead) return;

  lead.name = document.getElementById('edit-name').value.trim() || lead.name;
  lead.phone = document.getElementById('edit-phone').value.trim();
  lead.email = document.getElementById('edit-email').value.trim();
  lead.website = document.getElementById('edit-website').value.trim();
  lead.status = document.getElementById('edit-status').value;
  lead.notes = document.getElementById('edit-notes').value.trim();
  lead.lastModified = new Date().toISOString();

  saveLeads();
  renderCRM();
  closeModal();
  showToast('Lead updated', 'success');
}

function closeModal() {
  document.getElementById('lead-modal').classList.add('hidden');
  state.editingLeadId = null;
}

// ============================================================
// EXCEL EXPORT
// ============================================================
function exportToExcel() {
  if (!window.XLSX) {
    showToast('Excel library not loaded yet. Please try again.', 'error');
    return;
  }
  const leads = getFilteredLeads();
  if (leads.length === 0) {
    showToast('No leads to export', 'warning');
    return;
  }

  const rows = leads.map((l, i) => ({
    'No.': i + 1,
    'Business Name': l.name,
    'Category': (l.categories || []).join(', '),
    'Address': l.address,
    'Phone': l.phone || '',
    'Website': l.website || '',
    'Email': l.email || '',
    'Rating': l.rating || '',
    'Reviews': l.reviewCount || '',
    'Status': STATUSES[l.status]?.label || l.status,
    'Notes': l.notes || '',
    'Source': l.source || 'Google Maps',
    'Date Added': fmtDateFull(l.dateAdded),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  // Column widths
  ws['!cols'] = [
    { wch: 5 }, { wch: 32 }, { wch: 20 }, { wch: 40 }, { wch: 18 },
    { wch: 30 }, { wch: 28 }, { wch: 8 }, { wch: 10 }, { wch: 15 },
    { wch: 40 }, { wch: 14 }, { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');

  const fname = `Varadata_${fmtDateFile()}.xlsx`;
  XLSX.writeFile(wb, fname);
  showToast(`Exported ${leads.length} leads to ${fname}`, 'success');
}

// ============================================================
// PWA
// ============================================================
function installPWA() {
  if (!window._pwaPrompt) return;
  window._pwaPrompt.prompt();
  window._pwaPrompt.userChoice.then(result => {
    if (result.outcome === 'accepted') {
      document.getElementById('install-btn').classList.add('hidden');
      showToast('Varadata installed!', 'success');
    }
    window._pwaPrompt = null;
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));
  }
}

// ============================================================
// SEARCH UI HELPERS
// ============================================================
function setSearchLoading(on) {
  const btn = document.getElementById('search-btn');
  const empty = document.getElementById('search-empty');

  if (on) {
    btn.innerHTML = `<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Searching…`;
    btn.disabled = true;
    empty.classList.add('hidden');
    document.getElementById('results-area').classList.add('hidden');
    // Show skeleton
    document.getElementById('results-area').innerHTML = skeletonHTML();
    document.getElementById('results-area').classList.remove('hidden');
  } else {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Search`;
    btn.disabled = false;
  }
}

function skeletonHTML() {
  return `
  <div class="results-toolbar">
    <div class="skeleton" style="width:140px;height:20px"></div>
    <div class="skeleton" style="width:200px;height:32px"></div>
  </div>
  <div class="results-grid">
    ${[...Array(6)].map(() => `
    <div class="result-card" style="pointer-events:none">
      <div class="skeleton" style="height:16px;width:70%;margin-bottom:8px"></div>
      <div class="skeleton" style="height:12px;width:40%;margin-bottom:12px"></div>
      <div class="skeleton" style="height:12px;width:90%"></div>
    </div>`).join('')}
  </div>`;
}

function showResultsArea(show) {
  const area = document.getElementById('results-area');
  const empty = document.getElementById('search-empty');
  if (show) {
    area.innerHTML = '';
    area.classList.remove('hidden');
    // Rebuild inner structure
    area.innerHTML = `
      <div class="results-toolbar">
        <div class="results-info"><span id="results-count-label">0 results</span></div>
        <div class="results-tools">
          <label class="option-check">
            <input type="checkbox" id="select-all-check" onchange="toggleSelectAll(this.checked)">
            <span class="check-box"></span>
            Select all
          </label>
          <button class="btn btn-sm btn-primary" id="add-selected-btn" onclick="addSelectedToCRM()" disabled>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add to CRM (<span id="sel-count">0</span>)
          </button>
        </div>
      </div>
      <div id="results-grid" class="results-grid"></div>
      <div id="load-more-wrap" class="load-more-wrap hidden">
        <button class="btn btn-outline" id="load-more-btn" onclick="loadMore()">
          Load more results
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>`;
    empty.classList.add('hidden');
  } else {
    area.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}

function clearSearch() {
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.add('hidden');
  document.getElementById('results-area').classList.add('hidden');
  document.getElementById('search-empty').classList.remove('hidden');
  state.searchResults = [];
  state.selectedIds.clear();
  document.getElementById('search-input').focus();
}

function toggleLocationOpts() {
  const checked = document.getElementById('use-location').checked;
  document.getElementById('location-opts').classList.toggle('hidden', !checked);
}

// ============================================================
// TOAST
// ============================================================
function showToast(msg, type = 'info') {
  const icons = {
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icons[type] || ''}<span>${esc(msg)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 200);
  }, 3500);
}

// ============================================================
// UTILITIES
// ============================================================
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function starStr(rating) {
  const full = Math.round(rating);
  return '★'.repeat(Math.min(full, 5)) + '☆'.repeat(Math.max(0, 5 - full));
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch { return url; }
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateFull(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US');
}

function fmtDateFile() {
  return new Date().toISOString().slice(0, 10);
}

// ============================================================
// KEYBOARD SHORTCUT FOR MODAL
// ============================================================
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('lead-modal');
    if (!modal.classList.contains('hidden')) closeModal();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const modal = document.getElementById('lead-modal');
    if (!modal.classList.contains('hidden') && state.editingLeadId) saveLeadEdit();
  }
});
