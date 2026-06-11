const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const XLSX = require("xlsx");

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
  ".png": "image/png",
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
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*-\s*/g, "-");
}

function makeKey(model, variant) {
  return `${normalize(model)}___${normalize(variant)}`;
}

function isDuplicateLookupKeyError(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("products_lookup_key_key") || text.includes("duplicate key value");
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

function mapIncoming(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    model: row.model,
    variant: row.variant,
    qty: Number(row.qty || 0),
    buyPrice: Number(row.buy_price || 0),
    total: Number(row.total || 0),
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
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
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

function buildDailySummary(incomingLogs, sales) {
  const dayMap = new Map();

  incomingLogs.forEach((x) => {
    const day = new Date(x.createdAt).toISOString().slice(0, 10);
    const item = dayMap.get(day) || { incomingQty: 0, incomingTotal: 0, salesQty: 0, salesTotal: 0, profit: 0 };
    item.incomingQty += Number(x.qty || 0);
    item.incomingTotal += Number(x.total || 0);
    dayMap.set(day, item);
  });

  sales.forEach((x) => {
    const day = new Date(x.createdAt).toISOString().slice(0, 10);
    const item = dayMap.get(day) || { incomingQty: 0, incomingTotal: 0, salesQty: 0, salesTotal: 0, profit: 0 };
    item.salesQty += Number(x.qty || 0);
    item.salesTotal += Number(x.sales || 0);
    item.profit += Number(x.profit || 0);
    dayMap.set(day, item);
  });

  return [...dayMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, item]) => ({
      Sana: day,
      "Kirim soni": item.incomingQty,
      "Kirim summasi": item.incomingTotal,
      "Chiqim soni": item.salesQty,
      "Sotuv summasi": item.salesTotal,
      Foyda: item.profit,
    }));
}

function buildSalesByProductSummary(sales) {
  const map = new Map();

  sales.forEach((x) => {
    const key = `${x.model}___${x.variant}`;
    const item = map.get(key) || {
      Model: x.model,
      Variant: x.variant,
      "Chiqim soni": 0,
      Tannarx: 0,
      Sotuv: 0,
      Foyda: 0,
    };

    item["Chiqim soni"] += Number(x.qty || 0);
    item.Tannarx += Number(x.cost || 0);
    item.Sotuv += Number(x.sales || 0);
    item.Foyda += Number(x.profit || 0);
    map.set(key, item);
  });

  return [...map.values()].sort((a, b) => Number(b.Sotuv || 0) - Number(a.Sotuv || 0));
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

async function getIncomingLogs() {
  const query = new URLSearchParams({
    select: "id,created_at,model,variant,qty,buy_price,total",
    order: "created_at.desc",
  });

  const rows = await supabaseRequest(`/incoming_logs?${query.toString()}`);
  return Array.isArray(rows) ? rows.map(mapIncoming) : [];
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

async function getProductById(id) {
  const query = new URLSearchParams({
    select: "id,model,variant,lookup_key,qty,buy_price,created_at,updated_at",
    id: `eq.${id}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`/products?${query.toString()}`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function getSaleById(id) {
  const query = new URLSearchParams({
    select: "id,created_at,model,variant,qty,buy_price,sell_price,cost,sales,profit",
    id: `eq.${id}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`/sales?${query.toString()}`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function getIncomingLogById(id) {
  const query = new URLSearchParams({
    select: "id,created_at,model,variant,qty,buy_price,total",
    id: `eq.${id}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`/incoming_logs?${query.toString()}`);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0];
}

async function patchProductById(id, product) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest(`/products?${query.toString()}`, {
    method: "PATCH",
    prefer: "return=minimal",
    body: {
      model: product.model,
      variant: product.variant,
      lookup_key: makeKey(product.model, product.variant),
      qty: Number(product.qty || 0),
      buy_price: Number(product.buyPrice || 0),
      updated_at: new Date().toISOString(),
    },
  });
}

async function deleteIncomingLogById(id) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest(`/incoming_logs?${query.toString()}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function deleteSaleById(id) {
  const query = new URLSearchParams({ id: `eq.${id}` });
  await supabaseRequest(`/sales?${query.toString()}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function restoreProduct(product) {
  await supabaseRequest("/products", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      id: product.id,
      model: product.model,
      variant: product.variant,
      lookup_key: makeKey(product.model, product.variant),
      qty: Number(product.qty || 0),
      buy_price: Number(product.buyPrice || 0),
      created_at: product.createdAt || new Date().toISOString(),
      updated_at: product.updatedAt || new Date().toISOString(),
    },
  });
}

async function restoreIncomingLog(log) {
  await supabaseRequest("/incoming_logs", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      id: log.id,
      created_at: log.createdAt || new Date().toISOString(),
      model: log.model,
      variant: log.variant,
      qty: Number(log.qty || 0),
      buy_price: Number(log.buyPrice || 0),
      total: Number(log.total || 0),
    },
  });
}

async function restoreSale(sale) {
  await supabaseRequest("/sales", {
    method: "POST",
    prefer: "return=minimal",
    body: {
      id: sale.id,
      created_at: sale.createdAt || new Date().toISOString(),
      model: sale.model,
      variant: sale.variant,
      qty: Number(sale.qty || 0),
      buy_price: Number(sale.buyPrice || 0),
      sell_price: Number(sale.sellPrice || 0),
      cost: Number(sale.cost || 0),
      sales: Number(sale.sales || 0),
      profit: Number(sale.profit || 0),
    },
  });
}

async function mergeIncomingStock(existing, qty, price, now) {
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
}

function parseClientDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00.000Z`).toISOString();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Sana noto‘g‘ri kiritildi.");
  }
  return parsed.toISOString();
}

async function handleApi(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
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
      const [products, sales, incomingLogs] = await Promise.all([getProducts(), getSales(), getIncomingLogs()]);
      sendJson(res, 200, {
        products,
        sales,
        incomingLogs,
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
    let createdAt;

    if (!model || !variant || !(qty > 0) || price < 0) {
      sendJson(res, 400, { error: "Model, variant, soni va olingan narxini to‘g‘ri kiriting." });
      return true;
    }

    try {
      createdAt = parseClientDate(body.date);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    try {
      const now = new Date().toISOString();
      const lookupKey = makeKey(model, variant);
      const existing = await getProductByKey(lookupKey);
      const previousProduct = existing ? mapProduct(existing) : null;
      let activeProductId = existing ? existing.id : null;

      if (existing) {
        await mergeIncomingStock(existing, qty, price, now);
      } else {
        try {
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
          const createdProduct = await getProductByKey(lookupKey);
          activeProductId = createdProduct?.id || null;
        } catch (err) {
          // If another request inserted the same lookup_key first, recover by
          // fetching the row and folding this stock into the existing product.
          if (!isDuplicateLookupKeyError(err.message)) {
            throw err;
          }

          const conflicted = await getProductByKey(lookupKey);
          if (!conflicted) {
            throw err;
          }

          activeProductId = conflicted.id;
          await mergeIncomingStock(conflicted, qty, price, now);
        }
      }

      const insertedIncoming = await supabaseRequest("/incoming_logs", {
        method: "POST",
        prefer: "return=representation",
        body: {
          created_at: createdAt,
          model,
          variant,
          qty,
          buy_price: price,
          total: qty * price,
        },
      });

      const currentProduct = activeProductId ? await getProductById(activeProductId) : await getProductByKey(lookupKey);
      const createdLog = Array.isArray(insertedIncoming) && insertedIncoming[0] ? mapIncoming(insertedIncoming[0]) : null;

      sendJson(res, 200, {
        ok: true,
        message: "Kirim saqlandi.",
        productBefore: previousProduct,
        productAfter: currentProduct ? mapProduct(currentProduct) : null,
        incomingLog: createdLog,
      });
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
    let createdAt;

    if (!model || !variant || !(qty > 0) || sellPrice < 0) {
      sendJson(res, 400, { error: "Model, variant, chiqim soni va sotilgan narxini to‘g‘ri kiriting." });
      return true;
    }

    try {
      createdAt = parseClientDate(body.date);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
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

      const previousProduct = mapProduct(existing);
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

      const insertedSale = await supabaseRequest("/sales", {
        method: "POST",
        prefer: "return=representation",
        body: {
          created_at: createdAt,
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

      const currentProduct = await getProductById(existing.id);
      const createdSale = Array.isArray(insertedSale) && insertedSale[0] ? mapSale(insertedSale[0]) : null;

      sendJson(res, 200, {
        ok: true,
        profit,
        message: "Chiqim saqlandi.",
        productBefore: previousProduct,
        productAfter: currentProduct ? mapProduct(currentProduct) : null,
        sale: createdSale,
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  const productMatch = url.pathname.match(/^\/api\/products\/(\d+)$/);
  if (productMatch && req.method === "PATCH") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    const id = Number(productMatch[1]);
    const model = String(body.model || "").trim();
    const variant = String(body.variant || "").trim();
    const qty = Number(body.qty);
    const buyPrice = Number(body.buyPrice);

    if (!model || !variant || qty < 0 || buyPrice < 0) {
      sendJson(res, 400, { error: "Model, variant, son va narxni to‘g‘ri kiriting." });
      return true;
    }

    try {
      const existing = await getProductById(id);
      if (!existing) {
        sendJson(res, 404, { error: "Mahsulot topilmadi." });
        return true;
      }

      const now = new Date().toISOString();
      const lookupKey = makeKey(model, variant);
      const query = new URLSearchParams({ id: `eq.${id}` });
      await supabaseRequest(`/products?${query.toString()}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          model,
          variant,
          lookup_key: lookupKey,
          qty,
          buy_price: buyPrice,
          updated_at: now,
        },
      });
      const updated = await getProductById(id);
      sendJson(res, 200, {
        ok: true,
        message: "Qoldiq yangilandi.",
        previous: mapProduct(existing),
        current: updated ? mapProduct(updated) : null,
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/products/restore") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    try {
      await restoreProduct(body.product || body);
      sendJson(res, 200, { ok: true, message: "Mahsulot qayta tiklandi." });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (productMatch && req.method === "DELETE") {
    const id = Number(productMatch[1]);
    try {
      const existing = await getProductById(id);
      if (!existing) {
        sendJson(res, 404, { error: "Mahsulot topilmadi." });
        return true;
      }
      const query = new URLSearchParams({ id: `eq.${id}` });
      await supabaseRequest(`/products?${query.toString()}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      sendJson(res, 200, {
        ok: true,
        message: "Mahsulot o‘chirildi.",
        deleted: mapProduct(existing),
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  const saleMatch = url.pathname.match(/^\/api\/sales\/(\d+)$/);
  if (saleMatch && req.method === "PATCH") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    const id = Number(saleMatch[1]);
    const model = String(body.model || "").trim();
    const variant = String(body.variant || "").trim();
    const qty = Number(body.qty);
    const sellPrice = Number(body.sellPrice);
    let createdAt;

    if (!model || !variant || !(qty > 0) || sellPrice < 0) {
      sendJson(res, 400, { error: "Model, variant, chiqim soni va sotilgan narxini to‘g‘ri kiriting." });
      return true;
    }

    try {
      createdAt = parseClientDate(body.date);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    try {
      const existingSaleRaw = await getSaleById(id);
      if (!existingSaleRaw) {
        sendJson(res, 404, { error: "Chiqim topilmadi." });
        return true;
      }

      const existingSale = mapSale(existingSaleRaw);
      const oldProductRaw = await getProductByKey(makeKey(existingSale.model, existingSale.variant));
      if (!oldProductRaw) {
        sendJson(res, 404, { error: "Eski mahsulot qoldiqda topilmadi." });
        return true;
      }

      const newProductRaw = await getProductByKey(makeKey(model, variant));
      if (!newProductRaw) {
        sendJson(res, 404, { error: "Yangi mahsulot qoldiqda topilmadi." });
        return true;
      }

      const oldProductBefore = mapProduct(oldProductRaw);
      const newProductBefore = mapProduct(newProductRaw);
      const now = new Date().toISOString();

      if (oldProductRaw.id === newProductRaw.id) {
        const availableQty = Number(oldProductRaw.qty || 0) + Number(existingSale.qty || 0);
        if (availableQty < qty) {
          sendJson(res, 400, { error: `Qoldiq yetarli emas. Hozirgi mavjud son: ${availableQty}` });
          return true;
        }

        await supabaseRequest(`/products?id=eq.${oldProductRaw.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            qty: availableQty - qty,
            updated_at: now,
          },
        });
      } else {
        if (Number(newProductRaw.qty || 0) < qty) {
          sendJson(res, 400, { error: `Yangi mahsulot qoldig‘i yetarli emas. Hozirgi qoldiq: ${newProductRaw.qty}` });
          return true;
        }

        await supabaseRequest(`/products?id=eq.${oldProductRaw.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            qty: Number(oldProductRaw.qty || 0) + Number(existingSale.qty || 0),
            updated_at: now,
          },
        });

        await supabaseRequest(`/products?id=eq.${newProductRaw.id}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            qty: Number(newProductRaw.qty || 0) - qty,
            updated_at: now,
          },
        });
      }

      const buyPrice = Number(newProductRaw.buy_price || 0);
      const cost = qty * buyPrice;
      const totalSales = qty * sellPrice;
      const profit = totalSales - cost;

      await supabaseRequest(`/sales?id=eq.${id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          created_at: createdAt,
          model,
          variant,
          qty,
          buy_price: buyPrice,
          sell_price: sellPrice,
          cost,
          sales: totalSales,
          profit,
        },
      });

      sendJson(res, 200, {
        ok: true,
        message: "Chiqim yangilandi.",
        previousSale: existingSale,
        currentSale: mapSale(await getSaleById(id)),
        oldProductBefore,
        oldProductAfter: mapProduct(await getProductById(oldProductRaw.id)),
        newProductBefore,
        newProductAfter: mapProduct(await getProductById(newProductRaw.id)),
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (saleMatch && req.method === "DELETE") {
    const id = Number(saleMatch[1]);
    try {
      const saleRaw = await getSaleById(id);
      if (!saleRaw) {
        sendJson(res, 404, { error: "Chiqim topilmadi." });
        return true;
      }

      const sale = mapSale(saleRaw);
      const productRaw = await getProductByKey(makeKey(sale.model, sale.variant));
      if (!productRaw) {
        sendJson(res, 404, { error: "Mahsulot qoldiqda topilmadi." });
        return true;
      }

      const previousProduct = mapProduct(productRaw);
      await supabaseRequest(`/products?id=eq.${productRaw.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          qty: Number(productRaw.qty || 0) + Number(sale.qty || 0),
          updated_at: new Date().toISOString(),
        },
      });
      await deleteSaleById(id);

      sendJson(res, 200, {
        ok: true,
        message: "Chiqim o‘chirildi.",
        deleted: sale,
        productBefore: previousProduct,
        productAfter: mapProduct(await getProductById(productRaw.id)),
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/sales/restore") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    try {
      const sale = body.sale || body;
      const productRaw = await getProductByKey(makeKey(sale.model, sale.variant));
      if (!productRaw) {
        sendJson(res, 404, { error: "Mahsulot qoldiqda topilmadi." });
        return true;
      }
      if (Number(productRaw.qty || 0) < Number(sale.qty || 0)) {
        sendJson(res, 400, { error: "Qoldiq yetarli emas, chiqimni qayta tiklab bo‘lmadi." });
        return true;
      }

      await supabaseRequest(`/products?id=eq.${productRaw.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          qty: Number(productRaw.qty || 0) - Number(sale.qty || 0),
          updated_at: new Date().toISOString(),
        },
      });
      await restoreSale(sale);
      sendJson(res, 200, { ok: true, message: "Chiqim qayta tiklandi." });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  const incomingMatch = url.pathname.match(/^\/api\/incoming-logs\/(\d+)$/);
  if (incomingMatch && req.method === "DELETE") {
    const id = Number(incomingMatch[1]);
    try {
      const log = await getIncomingLogById(id);
      if (!log) {
        sendJson(res, 404, { error: "Kirim yozuvi topilmadi." });
        return true;
      }
      await deleteIncomingLogById(id);
      sendJson(res, 200, { ok: true, message: "Kirim yozuvi o‘chirildi.", deleted: mapIncoming(log) });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/incoming-logs/restore") {
    let body;
    try {
      body = await parseBody(req);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
      return true;
    }

    try {
      await restoreIncomingLog(body.log || body);
      sendJson(res, 200, { ok: true, message: "Kirim yozuvi qayta tiklandi." });
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

  if (req.method === "GET" && url.pathname === "/api/export/xlsx") {
    try {
      const [products, incomingLogs, sales] = await Promise.all([getProducts(), getIncomingLogs(), getSales()]);
      const workbook = XLSX.utils.book_new();
      const summarySheet = XLSX.utils.json_to_sheet([
        {
          "Jami qoldiq": computeSummary(products, sales).totalQty,
          "Qoldiq summasi": computeSummary(products, sales).stockValue,
          "Sotuv summasi": computeSummary(products, sales).totalSales,
          Foyda: computeSummary(products, sales).totalProfit,
        },
      ]);
      const stockSheet = XLSX.utils.json_to_sheet(
        products.map((x) => ({
          Model: x.model,
          Variant: x.variant,
          "Qoldiq soni": x.qty,
          "Olingan narx": x.buyPrice,
          "Qoldiq summasi": Number(x.qty || 0) * Number(x.buyPrice || 0),
          "Yangilangan sana": x.updatedAt || x.createdAt,
        }))
      );

      const incomingSheet = XLSX.utils.json_to_sheet(
        incomingLogs.map((x) => ({
          Sana: new Date(x.createdAt).toLocaleString("uz-UZ"),
          Model: x.model,
          Variant: x.variant,
          Soni: x.qty,
          "Olingan narx": x.buyPrice,
          Jami: x.total,
        }))
      );

      const salesSheet = XLSX.utils.json_to_sheet(
        sales.map((x) => ({
          Sana: new Date(x.createdAt).toLocaleString("uz-UZ"),
          Model: x.model,
          Variant: x.variant,
          Soni: x.qty,
          "Olingan narx": x.buyPrice,
          "Sotilgan narx": x.sellPrice,
          Tannarx: x.cost,
          Sotuv: x.sales,
          Foyda: x.profit,
        }))
      );

      const dailySheet = XLSX.utils.json_to_sheet(buildDailySummary(incomingLogs, sales));
      const salesByProductSheet = XLSX.utils.json_to_sheet(buildSalesByProductSummary(sales));

      XLSX.utils.book_append_sheet(workbook, summarySheet, "Umumiy");
      XLSX.utils.book_append_sheet(workbook, stockSheet, "Qoldiq");
      XLSX.utils.book_append_sheet(workbook, incomingSheet, "Kirim");
      XLSX.utils.book_append_sheet(workbook, salesSheet, "Chiqim");
      XLSX.utils.book_append_sheet(workbook, dailySheet, "Kunlik_hisobot");
      XLSX.utils.book_append_sheet(workbook, salesByProductSheet, "Model_kesimi");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=ombor_hisobot.xlsx",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(buffer);
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
      await supabaseRequest("/incoming_logs?id=gt.0", {
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
