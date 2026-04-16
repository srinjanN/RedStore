/**
 * RedStore — Shared Frontend Module
 * Handles: API calls, Authentication, Cart (localStorage), UI helpers
 */

// Use var (not const) so these are attached to window and visible
// to all other <script> tags on the page
var API_BASE = 'http://localhost:5000/api';

// ══════════════════════════════════════════════
//  API Client
// ══════════════════════════════════════════════
var api = {
  async request(path, method = 'GET', body = null, auth = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = store.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    try {
      const res = await fetch(`${API_BASE}${path}`, opts);
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      console.error('API error:', err);
      return { ok: false, data: { message: 'Network error — is the server running?' } };
    }
  },
  get:    (path, auth = false) => api.request(path, 'GET', null, auth),
  post:   (path, body, auth = false) => api.request(path, 'POST', body, auth),
  put:    (path, body, auth = false) => api.request(path, 'PUT', body, auth),
  delete: (path, auth = false) => api.request(path, 'DELETE', null, auth),
};

// ══════════════════════════════════════════════
//  Auth Store
// ══════════════════════════════════════════════
var store = {
  getToken:    () => localStorage.getItem('rs_token'),
  getUser:     () => { try { return JSON.parse(localStorage.getItem('rs_user')); } catch { return null; } },
  setSession:  (token, user) => { localStorage.setItem('rs_token', token); localStorage.setItem('rs_user', JSON.stringify(user)); },
  clearSession:() => { localStorage.removeItem('rs_token'); localStorage.removeItem('rs_user'); },
  isLoggedIn:  () => !!localStorage.getItem('rs_token'),
};

// ══════════════════════════════════════════════
//  Cart (localStorage)
// ══════════════════════════════════════════════
var cart = {
  get() { try { return JSON.parse(localStorage.getItem('rs_cart')) || []; } catch { return []; } },
  save(items) { localStorage.setItem('rs_cart', JSON.stringify(items)); cart.updateBadge(); },
  add(product, qty = 1, size = '', color = '') {
    const items = cart.get();
    const key = `${product.id}-${size}-${color}`;
    const existing = items.find(i => i.key === key);
    if (existing) existing.quantity += qty;
    else items.push({ key, productId: product.id, name: product.name, price: product.price, image: product.image, quantity: qty, size, color });
    cart.save(items);
    cart.showToast(`"${product.name}" added to cart!`);
  },
  remove(key)  { cart.save(cart.get().filter(i => i.key !== key)); },
  update(key, qty) {
    const items = cart.get();
    const item = items.find(i => i.key === key);
    if (item) { if (qty <= 0) cart.remove(key); else { item.quantity = qty; cart.save(items); } }
  },
  clear()   { cart.save([]); },
  count()   { return cart.get().reduce((sum, i) => sum + i.quantity, 0); },
  subtotal(){ return cart.get().reduce((sum, i) => sum + i.price * i.quantity, 0); },
  updateBadge() {
    const badge = document.getElementById('cart-badge');
    const count = cart.count();
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'flex' : 'none'; }
  },
  showToast(msg) {
    let toast = document.getElementById('rs-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'rs-toast';
      toast.style.cssText = 'position:fixed;bottom:30px;right:30px;background:#ff523b;color:#fff;padding:14px 22px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 4px 20px rgba(255,82,59,0.4);transform:translateY(100px);transition:transform 0.3s;font-family:Poppins,sans-serif;max-width:300px;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.transform = 'translateY(0)';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.style.transform = 'translateY(100px)'; }, 3000);
  }
};

// ══════════════════════════════════════════════
//  Navbar — shared across all pages
// ══════════════════════════════════════════════
function initNavbar() {
  cart.updateBadge();

  // Mobile menu
  const menuIcon = document.querySelector('.menu-icon');
  const menuItems = document.getElementById('MenuItems');
  if (menuIcon && menuItems) {
    menuItems.style.maxHeight = '0px';
    menuIcon.onclick = () => {
      menuItems.style.maxHeight = menuItems.style.maxHeight === '0px' ? '300px' : '0px';
    };
  }

  // Search bar (if present)
  const searchInput = document.getElementById('navbar-search');
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener('input', async (e) => {
      clearTimeout(searchTimeout);
      const q = e.target.value.trim();
      const dropdown = document.getElementById('search-dropdown');
      if (!q) { if (dropdown) dropdown.style.display = 'none'; return; }
      searchTimeout = setTimeout(async () => {
        const { ok, data } = await api.get(`/search?q=${encodeURIComponent(q)}`);
        if (ok && data.length) {
          showSearchDropdown(data, dropdown, searchInput);
        } else if (dropdown) {
          dropdown.style.display = 'none';
        }
      }, 300);
    });
    document.addEventListener('click', (e) => {
      const d = document.getElementById('search-dropdown');
      if (d && !searchInput.contains(e.target)) d.style.display = 'none';
    });
  }

  // Active link
  const links = document.querySelectorAll('nav ul li a');
  links.forEach(link => {
    if (link.href === window.location.href) link.style.color = '#ff523b';
  });
}

function showSearchDropdown(results, dropdown, input) {
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'search-dropdown';
    dropdown.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #eee;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:1000;overflow:hidden;';
    input.parentElement.style.position = 'relative';
    input.parentElement.appendChild(dropdown);
  }
  dropdown.innerHTML = results.map(p => `
    <a href="products-details.html?id=${p.id}" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid #f5f5f5;text-decoration:none;color:#333;transition:background 0.2s;" onmouseover="this.style.background='#fff5f4'" onmouseout="this.style.background='#fff'">
      <img src="${p.image}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;">
      <div>
        <div style="font-size:13px;font-weight:500;">${p.name}</div>
        <div style="font-size:12px;color:#ff523b;">$${p.price.toFixed(2)}</div>
      </div>
    </a>
  `).join('');
  dropdown.style.display = 'block';
}

// Stars helper
function starsHTML(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (rating >= i) html += '<i class="fa fa-star"></i>';
    else if (rating >= i - 0.5) html += '<i class="fa-solid fa-star-half-stroke"></i>';
    else html += '<i class="fa-regular fa-star"></i>';
  }
  return html;
}

// Price format
var fmt = (n) => `$${Number(n).toFixed(2)}`;

// Show error / success banner
function showBanner(msg, type = 'error', container = document.body) {
  const existing = container.querySelector('.rs-banner');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.className = 'rs-banner';
  div.style.cssText = `padding:12px 20px;margin:10px 0;border-radius:6px;font-size:13px;font-weight:500;background:${type === 'error' ? '#fff0ef' : '#e8faf0'};color:${type === 'error' ? '#d63031' : '#00b894'};border-left:4px solid ${type === 'error' ? '#d63031' : '#00b894'};`;
  div.textContent = msg;
  container.prepend(div);
  setTimeout(() => div.remove(), 5000);
}

// ══════════════════════════════════════════════
//  News helpers (used by news.html)
// ══════════════════════════════════════════════
var news = {
  // Try backend proxy first (works when server is running), then fall back to AllOrigins
  async fetchRSS(feedUrl) {
    // Try our own backend proxy
    try {
      const res = await fetch(`${API_BASE}/news/proxy?url=${encodeURIComponent(feedUrl)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) return res.text();
    } catch(_) {}
    // Fall back to AllOrigins
    const proxy = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(feedUrl)}`, { signal: AbortSignal.timeout(8000) });
    const json  = await proxy.json();
    return json.contents || '';
  },
  // Try backend headlines endpoint first
  async fetchHeadlines(topic) {
    try {
      const res = await fetch(`${API_BASE}/news/headlines?topic=${topic}`, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        if (data.articles?.length) return data.articles;
      }
    } catch(_) {}
    return null; // caller should fall back to direct RSS
  }
};

// On DOM ready
document.addEventListener('DOMContentLoaded', initNavbar);
