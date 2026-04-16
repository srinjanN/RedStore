/**
 * RedStore Backend API — Zero-dependency version
 * Uses only built-in Node.js modules: http, fs, crypto, url, querystring
 * Drop-in compatible: same routes, same responses as the Express version
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');
const crypto = require('crypto');

const PORT       = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'redstore_secret_key_2026';
const DB_PATH    = path.join(__dirname, 'db.json');
const FRONTEND   = path.join(__dirname, '../frontend');

// ─── Tiny JWT (HMAC-SHA256, no library needed) ───────────────────────────────
const jwt = {
  sign(payload, secret, opts = {}) {
    const header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const exp     = opts.expiresIn ? Math.floor(Date.now()/1000) + parseDuration(opts.expiresIn) : null;
    const claims  = exp ? { ...payload, exp, iat: Math.floor(Date.now()/1000) } : payload;
    const body    = b64url(JSON.stringify(claims));
    const sig     = b64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
    return `${header}.${body}.${sig}`;
  },
  verify(token, secret) {
    const [header, body, sig] = token.split('.');
    const expected = b64url(crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest());
    if (sig !== expected) throw new Error('Invalid signature');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) throw new Error('Token expired');
    return payload;
  }
};

function b64url(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return b.toString('base64url');
}
function parseDuration(s) {
  if (typeof s === 'number') return s;
  const m = s.match(/^(\d+)([smhd])$/);
  if (!m) return 86400;
  const n = +m[1];
  return { s:1, m:60, h:3600, d:86400 }[m[2]] * n;
}

// ─── Tiny bcrypt-like (SHA-256 salted) ───────────────────────────────────────
const bcrypt = {
  async hash(password, rounds) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
    return `$rs1$${salt}$${hash}`;
  },
  async compare(password, stored) {
    const [, , salt, hash] = stored.split('$');
    const attempt = crypto.createHash('sha256').update(salt + password).digest('hex');
    return attempt === hash;
  }
};

// ─── File DB ──────────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return initDB();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { return initDB(); }
}
function saveDB(data) { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); }
function initDB() {
  const data = {
    users: [], orders: [], reviews: [],
    coupons: [
      { code:'REDSTORE10', discount:10, type:'percent', active:true },
      { code:'SAVE20',     discount:20, type:'fixed',   active:true },
      { code:'WELCOME15',  discount:15, type:'percent', active:true }
    ]
  };
  saveDB(data); return data;
}

// ─── Product Dataset ──────────────────────────────────────────────────────────
const PRODUCTS = [
  { id:1,  name:'Red Printed T-Shirt',        price:50,  category:'tshirts',     rating:4.0, reviews:128, image:'images/product-1.jpg',  badge:'bestseller', stock:45, description:'Stylish red printed T-shirt with breathable fabric, perfect for casual outings and workouts.', sizes:['S','M','L','XL','XXL'], colors:['Red','White'] },
  { id:2,  name:'HRX Black Shoes',            price:100, category:'shoes',       rating:4.5, reviews:89,  image:'images/product-2.jpg',  badge:'trending',   stock:20, description:'Premium HRX sports shoes with cushioned sole and superior grip for all-day comfort.', sizes:['6','7','8','9','10','11'], colors:['Black'] },
  { id:3,  name:'Track Pant (Grey)',           price:150, category:'pants',       rating:3.5, reviews:64,  image:'images/product-3.jpg',  badge:'',           stock:35, description:'Comfortable grey track pants with elastic waistband and zippered pockets.', sizes:['S','M','L','XL'], colors:['Grey','Black'] },
  { id:4,  name:'Blue Polo T-Shirt',          price:75,  category:'tshirts',     rating:3.0, reviews:42,  image:'images/product-4.jpg',  badge:'',           stock:60, description:'Classic blue polo T-shirt suitable for office and casual wear.', sizes:['S','M','L','XL','XXL'], colors:['Blue','White','Black'] },
  { id:5,  name:'High Top Shoes (White)',      price:150, category:'shoes',       rating:4.0, reviews:73,  image:'images/product-5.jpg',  badge:'new',        stock:15, description:'Trendy white high-top sneakers with padded ankle support.', sizes:['6','7','8','9','10'], colors:['White'] },
  { id:6,  name:'Puma Roundneck T-Shirt',     price:100, category:'tshirts',     rating:4.5, reviews:156, image:'images/product-6.jpg',  badge:'bestseller', stock:50, description:'Authentic Puma roundneck T-shirt with moisture-wicking technology.', sizes:['S','M','L','XL'], colors:['Black','Navy'] },
  { id:7,  name:'Sports Socks (Pack of 3)',   price:50,  category:'accessories', rating:3.5, reviews:210, image:'images/product-7.jpg',  badge:'',           stock:100, description:'Durable sports socks with cushioning at heel and toe. Pack of 3.', sizes:['Free Size'], colors:['White','Black','Grey'] },
  { id:8,  name:'Black Fossil Watch',         price:250, category:'watches',     rating:3.0, reviews:38,  image:'images/product-8.jpg',  badge:'premium',    stock:12, description:'Elegant Fossil watch with scratch-resistant mineral glass and leather strap.', sizes:['One Size'], colors:['Black'] },
  { id:9,  name:'Roadstar Watch (Black)',      price:100, category:'watches',     rating:4.0, reviews:55,  image:'images/product-9.jpg',  badge:'',           stock:18, description:'Rugged Roadstar watch with chronograph and 50m water resistance.', sizes:['One Size'], colors:['Black','Silver'] },
  { id:10, name:'Sports Shoes (Black)',       price:120, category:'shoes',       rating:4.5, reviews:99,  image:'images/product-10.jpg', badge:'trending',   stock:25, description:'High-performance black sports shoes with breathable mesh upper.', sizes:['6','7','8','9','10','11'], colors:['Black','White'] },
  { id:11, name:'Walking Shoes (White)',      price:151, category:'shoes',       rating:3.5, reviews:47,  image:'images/product-11.jpg', badge:'',           stock:30, description:'Lightweight white walking shoes with EVA midsole for all-day comfort.', sizes:['6','7','8','9','10'], colors:['White','Grey'] },
  { id:12, name:'Nike Track Pant',           price:79,  category:'pants',       rating:3.0, reviews:61,  image:'images/product-12.jpg', badge:'',           stock:40, description:'Nike track pants with Dri-FIT technology to keep you dry during workouts.', sizes:['S','M','L','XL','XXL'], colors:['Black','Navy','Grey'] },
];

// ─── HTTP Server Helpers ──────────────────────────────────────────────────────
function getBody(req) {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { res(data ? JSON.parse(data) : {}); } catch { res({}); }
    });
    req.on('error', rej);
  });
}

function respond(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(body);
}

function serveFile(res, filePath) {
  const extMap = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript',
                   '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
                   '.ico':'image/x-icon', '.svg':'image/svg+xml', '.json':'application/json' };
  const ext  = path.extname(filePath);
  const mime = extMap[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

function authMiddleware(req) {
  const header = req.headers['authorization'] || '';
  const token  = header.replace('Bearer ', '');
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}

function parseQuery(rawQuery) {
  const q = {};
  if (!rawQuery) return q;
  rawQuery.split('&').forEach(pair => {
    const [k, v] = pair.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return q;
}

// ─── Route Handler ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url);
  const pathname = parsed.pathname;
  const query    = parseQuery(parsed.query);
  const method   = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization' });
    res.end(); return;
  }

  // ── API Routes ──────────────────────────────────────────────────────────────

  // GET /api/stats
  if (pathname === '/api/stats' && method === 'GET') {
    const db = loadDB();
    return respond(res, 200, { products: PRODUCTS.length, customers: db.users.length, orders: db.orders.length, categories: [...new Set(PRODUCTS.map(p=>p.category))].length });
  }

  // GET /api/products/featured
  if (pathname === '/api/products/featured' && method === 'GET') {
    return respond(res, 200, PRODUCTS.filter(p => p.badge === 'bestseller' || p.rating >= 4.0).slice(0, 8));
  }

  // GET /api/products/categories
  if (pathname === '/api/products/categories' && method === 'GET') {
    const cats = [...new Set(PRODUCTS.map(p=>p.category))];
    return respond(res, 200, cats.map(c => ({ name:c, count: PRODUCTS.filter(p=>p.category===c).length })));
  }

  // GET /api/products/:id  and  POST /api/products/:id/review
  const prodMatch = pathname.match(/^\/api\/products\/(\d+)(\/review)?$/);
  if (prodMatch) {
    const id = Number(prodMatch[1]);
    const isReview = !!prodMatch[2];

    if (isReview && method === 'POST') {
      const user = authMiddleware(req);
      if (!user) return respond(res, 401, { message: 'Authentication required' });
      const body = await getBody(req);
      const { rating, comment } = body;
      if (!rating || !comment) return respond(res, 400, { message: 'Rating and comment required' });
      const db = loadDB();
      const review = { id: Date.now(), productId: id, userId: user.id, username: user.username, rating: Math.min(5, Math.max(1, Number(rating))), comment, createdAt: new Date().toISOString() };
      db.reviews.push(review);
      saveDB(db);
      return respond(res, 201, { message: 'Review submitted', review });
    }

    if (!isReview && method === 'GET') {
      const product = PRODUCTS.find(p => p.id === id);
      if (!product) return respond(res, 404, { message: 'Product not found' });
      const db = loadDB();
      const reviews = db.reviews.filter(r => r.productId === id);
      const related = PRODUCTS.filter(p => p.category === product.category && p.id !== id).slice(0, 4);
      return respond(res, 200, { ...product, userReviews: reviews, related });
    }
  }

  // GET /api/products
  if (pathname === '/api/products' && method === 'GET') {
    let products = [...PRODUCTS];
    const { category, search, sort, minPrice, maxPrice, page=1, limit=12 } = query;
    if (category) products = products.filter(p => p.category === category);
    if (search)   products = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    if (minPrice) products = products.filter(p => p.price >= Number(minPrice));
    if (maxPrice) products = products.filter(p => p.price <= Number(maxPrice));
    switch (sort) {
      case 'price_asc':  products.sort((a,b)=>a.price-b.price); break;
      case 'price_desc': products.sort((a,b)=>b.price-a.price); break;
      case 'rating':     products.sort((a,b)=>b.rating-a.rating); break;
      case 'popularity': products.sort((a,b)=>b.reviews-a.reviews); break;
    }
    const total = products.length;
    const start = (page-1)*limit;
    return respond(res, 200, { products: products.slice(start, start+Number(limit)), total, page: Number(page), pages: Math.ceil(total/limit) });
  }

  // GET /api/search
  if (pathname === '/api/search' && method === 'GET') {
    const { q } = query;
    if (!q) return respond(res, 200, []);
    return respond(res, 200, PRODUCTS.filter(p => p.name.toLowerCase().includes(q.toLowerCase()) || p.category.toLowerCase().includes(q.toLowerCase())).slice(0, 5));
  }

  // POST /api/users/register
  if (pathname === '/api/users/register' && method === 'POST') {
    const { username, email, password } = await getBody(req);
    if (!username || !email || !password) return respond(res, 400, { message: 'All fields are required' });
    const db = loadDB();
    if (db.users.find(u => u.email === email)) return respond(res, 409, { message: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = { id: Date.now(), username, email, password: hashed, createdAt: new Date().toISOString(), wishlist: [], addresses: [] };
    db.users.push(user);
    saveDB(db);
    const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return respond(res, 201, { message: 'Registration successful', token, user: { id: user.id, username, email } });
  }

  // POST /api/users/login
  if (pathname === '/api/users/login' && method === 'POST') {
    const { email, password } = await getBody(req);
    if (!email || !password) return respond(res, 400, { message: 'Email and password required' });
    const db = loadDB();
    const user = db.users.find(u => u.email === email);
    if (!user) return respond(res, 401, { message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return respond(res, 401, { message: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    return respond(res, 200, { message: 'Login successful', token, user: { id: user.id, username: user.username, email: user.email } });
  }

  // GET /api/users/profile
  if (pathname === '/api/users/profile' && method === 'GET') {
    const user = authMiddleware(req);
    if (!user) return respond(res, 401, { message: 'Authentication required' });
    const db = loadDB();
    const u = db.users.find(u => u.id === user.id);
    if (!u) return respond(res, 404, { message: 'User not found' });
    const { password, ...safe } = u;
    const orders = db.orders.filter(o => o.userId === user.id);
    return respond(res, 200, { ...safe, orders });
  }

  // PUT /api/users/profile
  if (pathname === '/api/users/profile' && method === 'PUT') {
    const authUser = authMiddleware(req);
    if (!authUser) return respond(res, 401, { message: 'Authentication required' });
    const db = loadDB();
    const idx = db.users.findIndex(u => u.id === authUser.id);
    if (idx === -1) return respond(res, 404, { message: 'User not found' });
    const { username, currentPassword, newPassword, address } = await getBody(req);
    if (username) db.users[idx].username = username;
    if (address)  db.users[idx].addresses = [address, ...(db.users[idx].addresses||[]).slice(0,2)];
    if (newPassword && currentPassword) {
      const match = await bcrypt.compare(currentPassword, db.users[idx].password);
      if (!match) return respond(res, 400, { message: 'Current password is incorrect' });
      db.users[idx].password = await bcrypt.hash(newPassword, 10);
    }
    saveDB(db);
    const { password, ...safe } = db.users[idx];
    return respond(res, 200, { message: 'Profile updated', user: safe });
  }

  // GET /api/users/wishlist
  if (pathname === '/api/users/wishlist' && method === 'GET') {
    const user = authMiddleware(req);
    if (!user) return respond(res, 401, { message: 'Authentication required' });
    const db = loadDB();
    const u = db.users.find(u => u.id === user.id);
    const items = (u?.wishlist || []).map(id => PRODUCTS.find(p => p.id === id)).filter(Boolean);
    return respond(res, 200, items);
  }

  // POST /api/users/wishlist/:productId
  const wlMatch = pathname.match(/^\/api\/users\/wishlist\/(\d+)$/);
  if (wlMatch && method === 'POST') {
    const user = authMiddleware(req);
    if (!user) return respond(res, 401, { message: 'Authentication required' });
    const pid = Number(wlMatch[1]);
    if (!PRODUCTS.find(p => p.id === pid)) return respond(res, 404, { message: 'Product not found' });
    const db = loadDB();
    const idx = db.users.findIndex(u => u.id === user.id);
    const wl = db.users[idx].wishlist || [];
    if (wl.includes(pid)) {
      db.users[idx].wishlist = wl.filter(id => id !== pid);
      saveDB(db);
      return respond(res, 200, { message: 'Removed from wishlist', wishlist: db.users[idx].wishlist });
    }
    db.users[idx].wishlist = [...wl, pid];
    saveDB(db);
    return respond(res, 200, { message: 'Added to wishlist', wishlist: db.users[idx].wishlist });
  }

  // POST /api/cart/validate
  if (pathname === '/api/cart/validate' && method === 'POST') {
    const { items } = await getBody(req);
    if (!items?.length) return respond(res, 400, { message: 'Cart is empty' });
    const validated = [], errors = [];
    for (const item of items) {
      const product = PRODUCTS.find(p => p.id === item.productId);
      if (!product) { errors.push(`Product ${item.productId} not found`); continue; }
      if (product.stock < item.quantity) { errors.push(`${product.name} — only ${product.stock} in stock`); continue; }
      validated.push({ ...product, quantity: item.quantity, size: item.size, color: item.color, subtotal: product.price * item.quantity });
    }
    const subtotal = validated.reduce((s,i) => s + i.subtotal, 0);
    const tax      = Math.round(subtotal * 0.18 * 100) / 100;
    const shipping = subtotal > 200 ? 0 : 15;
    return respond(res, 200, { validated, errors, subtotal, tax, shipping, total: subtotal + tax + shipping });
  }

  // POST /api/cart/coupon
  if (pathname === '/api/cart/coupon' && method === 'POST') {
    const { code, subtotal } = await getBody(req);
    const db = loadDB();
    const coupon = db.coupons.find(c => c.code === (code||'').toUpperCase() && c.active);
    if (!coupon) return respond(res, 404, { message: 'Invalid or expired coupon code' });
    const discount = coupon.type === 'percent'
      ? Math.round(subtotal * coupon.discount / 100 * 100) / 100
      : Math.min(coupon.discount, subtotal);
    return respond(res, 200, { valid: true, coupon, discount, message: `Coupon applied! You save $${discount.toFixed(2)}` });
  }

  // POST /api/orders
  if (pathname === '/api/orders' && method === 'POST') {
    const user = authMiddleware(req);
    if (!user) return respond(res, 401, { message: 'Authentication required' });
    const body = await getBody(req);
    const { items, address, paymentMethod, couponCode, subtotal, tax, shipping, total } = body;
    if (!items?.length || !address) return respond(res, 400, { message: 'Items and address required' });
    const db = loadDB();
    const order = {
      id: `ORD-${Date.now()}`, userId: user.id, items, address,
      paymentMethod: paymentMethod || 'COD', couponCode, subtotal, tax, shipping, total,
      status: 'confirmed',
      timeline: [{ status: 'confirmed', date: new Date().toISOString(), message: 'Order placed and confirmed' }],
      createdAt: new Date().toISOString(),
      estimatedDelivery: new Date(Date.now() + 5*86400000).toISOString()
    };
    db.orders.push(order);
    saveDB(db);
    return respond(res, 201, { message: 'Order placed successfully!', order });
  }

  // GET /api/orders
  if (pathname === '/api/orders' && method === 'GET') {
    const user = authMiddleware(req);
    if (!user) return respond(res, 401, { message: 'Authentication required' });
    const db = loadDB();
    return respond(res, 200, db.orders.filter(o => o.userId === user.id).reverse());
  }

  // GET /api/orders/:id
  const orderMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (orderMatch && method === 'GET') {
    const user = authMiddleware(req);
    if (!user) return respond(res, 401, { message: 'Authentication required' });
    const db = loadDB();
    const order = db.orders.find(o => o.id === orderMatch[1] && o.userId === user.id);
    if (!order) return respond(res, 404, { message: 'Order not found' });
    return respond(res, 200, order);
  }

  // GET /api/news/proxy?url=<rss-url>  — server-side RSS proxy (avoids browser CORS)
  if (pathname === '/api/news/proxy' && method === 'GET') {
    const feedUrl = query.url;
    if (!feedUrl) return respond(res, 400, { message: 'url param required' });
    try {
      // Use Node built-in https/http to fetch RSS
      const httpMod = feedUrl.startsWith('https') ? require('https') : require('http');
      const rssData = await new Promise((resolve, reject) => {
        const req2 = httpMod.get(feedUrl, { headers: { 'User-Agent': 'RedStore-News-Bot/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml' }, timeout: 8000 }, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => resolve(data));
        });
        req2.on('error', reject);
        req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
      });
      res.writeHead(200, {
        'Content-Type': 'application/xml',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'  // 5-min cache
      });
      res.end(rssData);
    } catch(err) {
      respond(res, 502, { message: `RSS fetch failed: ${err.message}` });
    }
    return;
  }

  // GET /api/news/headlines?topic=<topic> — curated live headlines from multiple sources
  if (pathname === '/api/news/headlines' && method === 'GET') {
    const topic = query.topic || 'top';
    const RSS_FEEDS = {
      top:        ['https://feeds.bbci.co.uk/news/rss.xml', 'https://rss.cnn.com/rss/edition.rss'],
      fashion:    ['https://www.highsnobiety.com/feed/', 'https://fashionista.com/.rss/excerpt/'],
      sports:     ['https://feeds.bbci.co.uk/sport/rss.xml'],
      business:   ['https://feeds.a.dj.com/rss/RSSMarketsMain.xml'],
      technology: ['https://feeds.feedburner.com/TechCrunch'],
      lifestyle:  ['https://lifehacker.com/rss'],
      india:      ['https://feeds.bbci.co.uk/news/world/asia/india/rss.xml'],
    };
    const feeds = RSS_FEEDS[topic] || RSS_FEEDS.top;
    const httpMod = require('https');

    async function fetchOne(feedUrl) {
      return new Promise((resolve) => {
        const req2 = httpMod.get(feedUrl, { headers: { 'User-Agent': 'RedStore/1.0' }, timeout: 6000 }, (r) => {
          let data = '';
          r.on('data', c => data += c);
          r.on('end', () => resolve(data));
        });
        req2.on('error', () => resolve(''));
        req2.on('timeout', () => { req2.destroy(); resolve(''); });
      });
    }

    function parseRSS(xml, feedUrl) {
      const articles = [];
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
      items.slice(0, 10).forEach(item => {
        const get = (tag) => { const m = item.match(new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`)); return m ? m[1].trim() : ''; };
        const imgMatch = item.match(/url="([^"]+\.(jpg|jpeg|png|webp))"/i);
        articles.push({
          id:          Math.random().toString(36).slice(2),
          title:       get('title').replace(/<[^>]+>/g,''),
          description: get('description').replace(/<[^>]+>/g,'').slice(0, 200),
          url:         get('link'),
          image:       imgMatch ? imgMatch[1] : '',
          source:      { name: new URL(feedUrl).hostname.replace(/^www\.|^feeds\.|^rss\./,'').split('.')[0] },
          publishedAt: get('pubDate') ? new Date(get('pubDate')).toISOString() : new Date().toISOString(),
          category:    topic
        });
      });
      return articles.filter(a => a.title && a.url);
    }

    try {
      const results = await Promise.allSettled(feeds.map(fetchOne));
      let articles = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          articles.push(...parseRSS(r.value, feeds[i]));
        }
      });
      // Sort by date, deduplicate
      const seen = new Set();
      articles = articles.filter(a => { if (seen.has(a.title)) return false; seen.add(a.title); return true; });
      articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
      respond(res, 200, { articles, count: articles.length, topic, fetchedAt: new Date().toISOString() });
    } catch(err) {
      respond(res, 500, { message: 'Failed to fetch headlines', error: err.message });
    }
    return;
  }

  // GET /api/contacts
  if (pathname === '/api/contacts' && method === 'GET') {
    return respond(res, 200, [
      { role:'Owner',         name:'Mr. Srinjan Nandy',  phone:'+91 98765 43210', email:'owner@redstore.com',   address:'123 Main Street, Kolkata' },
      { role:'Store Manager', name:'Mr. Riddhi Basak',   phone:'+91 91234 56789', email:'manager@redstore.com', address:null },
      { role:'Support',       name:'Mr. Pratyay Roy',    phone:'+91 90000 11111', email:'support@redstore.com', address:'123 Main Street, Kolkata' }
    ]);
  }

  // POST /api/contact/message
  if (pathname === '/api/contact/message' && method === 'POST') {
    const { name, email, message } = await getBody(req);
    if (!name || !email || !message) return respond(res, 400, { message: 'All fields required' });
    console.log(`📬 Contact from ${name} <${email}>: ${message}`);
    return respond(res, 200, { message: 'Message received! We will get back to you within 24 hours.' });
  }

  // ── Static file serving ──────────────────────────────────────────────────────
  if (!pathname.startsWith('/api/')) {
    let filePath = path.join(FRONTEND, pathname === '/' ? 'index.html' : pathname);

    // If no extension (e.g. /about), try .html
    if (!path.extname(filePath)) filePath += '.html';

    if (fs.existsSync(filePath)) return serveFile(res, filePath);

    // Fallback to index.html for SPA-style navigation
    const indexPath = path.join(FRONTEND, 'index.html');
    if (fs.existsSync(indexPath)) return serveFile(res, indexPath);
  }

  respond(res, 404, { message: 'Route not found' });
});

server.listen(PORT, () => {
  console.log(`\n🚀 RedStore API running at http://localhost:${PORT}`);
  console.log(`📦 ${PRODUCTS.length} products loaded`);
  console.log(`📂 Database: ${DB_PATH}`);
  console.log(`🌐 Frontend: ${FRONTEND}\n`);
});

module.exports = server;
