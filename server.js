const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex <= 0) continue;

    const key = trimmed.slice(0, equalIndex).trim();
    const value = trimmed.slice(equalIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const BASE_DIR = __dirname;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
};

function getConfigError() {
  if (!SUPABASE_URL) return "SUPABASE_URL kiritilmagan";
  if (!SUPABASE_SERVICE_ROLE_KEY) return "SUPABASE_SERVICE_ROLE_KEY kiritilmagan";
  return null;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function makeKey(model, variant) {
  return `${normalize(model)}___${normalize(variant)}`;
}

function mapProduct(row) {
  return {
    id: row.id,
    model: row.model,
    variant: row.variant,
    qty: Number(row.qty || 0),
    buyPrice: Number(row.buy_price || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSale(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    model: row.model,
    variant: row.variant,
    qty: Number(row.qty || 0),
    buyPrice: Number(row.buy_price || 0),
    sellPrice: Number(row.sell_price || 0),
    cost: Number(row.cost || 0),
    sales: Number(row.sales || 0),
    profit: Number(row.profit || 0),
  };
}

function computeSummary(products, sales) {
  return {
    totalQty: products.reduce((sum, p) => sum + Number(p.qty || 0), 0),
    stockValue: products.reduce((sum, p) => sum + Number(p.qty || 0) * Number(p.buyPrice || 0), 0),
    totalSales: sales.reduce((sum, x) => sum + Number(x.sales || 0), 0),
    totalProfit: sales.reduce((sum, x) => sum + Number(x.profit || 0), 0),
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });

    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (_err) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function toCsv(rows) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          const s = String(v ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(",")
    )
    .join("\n");
}

async function supabaseRequest(resourcePath, options = {}) {
  const configError = getConfigError();
  if (configError) {
    throw new Error(configError);
  }

  const method = options.method || "GET";
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  if (options.prefer) {
    headers.Prefer = options.prefer;
  }

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1${resourcePath}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const raw = await response.text();
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  const parsed = raw && isJson ? JSON.parse(raw) : raw;

  if (!response.ok) {
    if (parsed && typeof parsed === "object") {
      const message = parsed.message || parsed.error || JSON.stringify(parsed);
      throw new Error(message);
    }
    throw new Error(raw || `Supabase xatosi (${response.status})`);
  }

  return parsed;
}

async function getProducts() {
  const query = new URLSearchParams({
    select: "id,model,variant,lookup_key,qty,buy_price,created_at,updated_at",
    order: "id.asc",
  });

  const rows = await supabaseRequest(`/products?${query.toString()}`);
  return Array.isArray(rows) ? rows.map(mapProduct) : [];
}

async function getSales() {
  const query = new URLSearchParams({
    select: "id,created_at,model,variant,qty,buy_price,sell_price,cost,sales,profit",
    order: "created_at.desc",
  });

  const rows = await supabaseRequest(`/sales?${query.toString()}`);
  return Array.isArray(rows) ? rows.map(mapSale) : [];
}

async function getProductByKey(lookupKey) {
  const query = new URLSearchParams({
    select: "id,model,variant,lookup_key,qty,buy_price,created_at,updated_at",
    lookup_key: `eq.${lookupKey}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`/products?${query.toString()}`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const configError = getConfigError();
    if (configError) {
      sendJson(res, 500, { ok: false, error: configError });
      return true;
    }

    try {
      await supabaseRequest("/products?select=id&limit=1");
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    try {
      const [products, sales] = await Promise.all([getProducts(), getSales()]);
      sendJson(res, 200, {
        products,
        sales,
        summary: computeSummary(products, sales),
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/in") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    const model = String(body.model || "").trim();
    const variant = String(body.variant || "").trim();
    const qty = Number(body.qty);
    const price = Number(body.price);

    if (!model || !variant || !(qty > 0) || price < 0) {
      sendJson(res, 400, { error: "Model, variant, soni va olingan narxini to‘g‘ri kiriting." });
      return true;
    }

    try {
      const now = new Date().toISOString();
      const lookupKey = makeKey(model, variant);
      const existing = await getProductByKey(lookupKey);

      if (existing) {
        const oldValue = Number(existing.qty || 0) * Number(existing.buy_price || 0);
        const newValue = qty * price;
        const newQty = Number(existing.qty || 0) + qty;
        const newBuyPrice = newQty > 0 ? (oldValue + newValue) / newQty : price;

        const query = new URLSearchParams({ id: `eq.${existing.id}` });
        await supabaseRequest(`/products?${query.toString()}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            qty: newQty,
            buy_price: newBuyPrice,
            updated_at: now,
          },
        });
      } else {
        await supabaseRequest("/products", {
          method: "POST",
          prefer: "return=minimal",
          body: {
            model,
            variant,
            lookup_key: lookupKey,
            qty,
            buy_price: price,
            created_at: now,
            updated_at: now,
          },
        });
      }

      sendJson(res, 200, { ok: true, message: "Kirim saqlandi." });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/out") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    const model = String(body.model || "").trim();
    const variant = String(body.variant || "").trim();
    const qty = Number(body.qty);
    const sellPrice = Number(body.sellPrice);

    if (!model || !variant || !(qty > 0) || sellPrice < 0) {
      sendJson(res, 400, { error: "Model, variant, chiqim soni va sotilgan narxini to‘g‘ri kiriting." });
      return true;
    }

    try {
      const now = new Date().toISOString();
      const lookupKey = makeKey(model, variant);
      const existing = await getProductByKey(lookupKey);

      if (!existing) {
        sendJson(res, 404, { error: "Bu mahsulot qoldiqda topilmadi. Avval kirim qiling." });
        return true;
      }

      if (Number(existing.qty || 0) < qty) {
        sendJson(res, 400, { error: `Qoldiq yetarli emas. Hozirgi qoldiq: ${existing.qty}` });
        return true;
      }

      const buyPrice = Number(existing.buy_price || 0);
      const cost = qty * buyPrice;
      const sales = qty * sellPrice;
      const profit = sales - cost;
      const newQty = Number(existing.qty || 0) - qty;

      const updateQuery = new URLSearchParams({ id: `eq.${existing.id}` });
      await supabaseRequest(`/products?${updateQuery.toString()}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          qty: newQty,
          updated_at: now,
        },
      });

      await supabaseRequest("/sales", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          created_at: now,
          model,
          variant,
          qty,
          buy_price: buyPrice,
          sell_price: sellPrice,
          cost,
          sales,
          profit,
        },
      });

      sendJson(res, 200, { ok: true, profit, message: "Chiqim saqlandi." });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/export/csv") {
    try {
      const sales = await getSales();
      const rows = [
        ["Sana", "Model", "Variant", "Soni", "Olingan narx", "Sotilgan narx", "Tannarx", "Sotuv", "Foyda"],
        ...sales.map((x) => [
          new Date(x.createdAt).toLocaleString("uz-UZ"),
          x.model,
          x.variant,
          x.qty,
          x.buyPrice,
          x.sellPrice,
          x.cost,
          x.sales,
          x.profit,
        ]),
      ];

      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=ombor_hisobot.csv",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(toCsv(rows));
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/reset") {
    try {
      await supabaseRequest("/sales?id=gt.0", {
        method: "DELETE",
        prefer: "return=minimal",
      });
      await supabaseRequest("/products?id=gt.0", {
        method: "DELETE",
        prefer: "return=minimal",
      });
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  return false;
}

function serveStatic(req, res, url) {
  const safePath = path.normalize(url.pathname).replace(/^\.\.(\/|\\|$)/, "");
  let filePath = path.join(BASE_DIR, safePath);

  if (url.pathname === "/") {
    filePath = path.join(BASE_DIR, "index.html");
  }

  if (!filePath.startsWith(BASE_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*",
    });

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const handled = await handleApi(req, res, url);
    if (handled) return;
    serveStatic(req, res, url);
  } catch (err) {
    sendJson(res, 500, { error: "Server xatosi", details: err.message });
  }
});

server.listen(PORT, () => {
  const cfgError = getConfigError();
  if (cfgError) {
    console.warn(`Ombor backend started, lekin konfiguratsiya to'liq emas: ${cfgError}`);
  }
  console.log(`Ombor backend running on http://localhost:${PORT}`);
});
