const $ = (id) => document.getElementById(id);
const q = (sel) => document.querySelector(sel);
const tpl = (id) => document.getElementById(id).content;

const DB_NAME = "ghDash";
const STORE = "profiles";
const STALE_MS = 1000 * 60 * 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "username" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getCached(username) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const req = st.get(username.toLowerCase());
      req.onsuccess = (e) => res(e.target.result?.payload ?? null);
      req.onerror = (e) => rej(e.target.error);
    });
  } catch (e) {
    return null;
  }
}

async function setCached(username, payload) {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const entry = {
        username: username.toLowerCase(),
        timestamp: Date.now(),
        payload,
      };
      const req = st.put(entry);
      req.onsuccess = () => res(true);
      req.onerror = (e) => rej(e.target.error);
    });
  } catch (e) {
    return false;
  }
}

function parseUsername(input) {
  if (!input) return null;
  input = input.trim();
  try {
    if (/^https?:\/\//i.test(input)) {
      const u = new URL(input);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length === 0) return null;
      return parts[0];
    }
  } catch (e) {}
  return input.replace(/^@/, "").split("/")[0];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeaders(token) {
  return token ? { Authorization: "token " + token } : {};
}

async function fetchJSON(url, token) {
  const res = await fetch(url, {
    headers: {
      ...authHeaders(token),
      Accept: "application/vnd.github.v3+json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => null);
    throw { status: res.status, message: text || res.statusText };
  }
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch: " + res.status);
  return res.text();
}

async function fetchUserAndRepos(username, token) {
  const user = await fetchJSON(
    `https://api.github.com/users/${username}`,
    token
  );
  const repos = await fetchJSON(
    `https://api.github.com/users/${username}/repos?per_page=100&sort=pushed`,
    token
  );
  return { user, repos };
}

async function fetchLanguagesForTop(repos, token, limit = 12) {
  const top = repos.slice(0, limit);
  const languageTotals = {};
  await Promise.all(
    top.map(async (r) => {
      try {
        const langs = await fetchJSON(r.languages_url, token);
        Object.entries(langs).forEach(([k, v]) => {
          languageTotals[k] = (languageTotals[k] || 0) + v;
        });
      } catch (e) {}
    })
  );
  return languageTotals;
}

async function fetchContribSvg(username) {
  try {
    const text = await fetchText(
      `https://github.com/users/${username}/contributions`
    );
    return text;
  } catch (e) {
    return null;
  }
}

function clearContainer(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function createCard(title, value, hint) {
  const frag = tpl("cardTpl").cloneNode(true);
  const root = frag.querySelector("div");
  root.querySelector("h4").textContent = title;
  root.querySelector("p").textContent = value;
  root.querySelectorAll("p")[1].textContent = hint || "";
  return frag;
}

async function renderOverviewSection(user, repos) {
  const overview = $("overview");
  overview.innerHTML = "";
  const totalStars = repos.reduce((s, r) => s + (r.stargazers_count || 0), 0);
  const forks = repos.reduce((s, r) => s + (r.forks_count || 0), 0);
  const pushed = repos.filter((r) => r.pushed_at).length;

  overview.appendChild(
    createCard(
      "Public repos",
      user.public_repos ?? repos.length,
      "Includes forks"
    )
  );
  overview.appendChild(createCard("Stars", totalStars, "Sum of stargazers"));
  overview.appendChild(createCard("Forks", forks, "Total forks"));

  Array.from(overview.children).forEach((c, i) => {
    c.animate(
      [
        { transform: "translateY(20px)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      {
        duration: 650,
        easing: "cubic-bezier(.16,1,.3,1)",
        delay: i * 80,
        fill: "forwards",
      }
    );
  });
}

function injectContribSvg(svgText, container) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) throw new Error("No SVG found");
    svg
      .querySelectorAll("[onload],[onclick],[onmouseover]")
      .forEach((n) => n.removeAttribute("onload"));
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("width", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const outer = new XMLSerializer().serializeToString(svg);
    container.innerHTML = outer;
    const inserted = container.querySelector("svg");
    if (inserted) {
      inserted.style.display = "block";
      inserted.style.maxWidth = "100%";
      inserted.style.height = "auto";
    }
    container.querySelectorAll("rect[data-count]").forEach((r) => {
      r.classList.add("transition-transform", "duration-150");
      r.addEventListener(
        "mouseenter",
        () => (r.style.transform = "translateY(-4px)")
      );
      r.addEventListener("mouseleave", () => (r.style.transform = ""));
    });
  } catch (e) {
    throw e;
  }
}

function drawFallbackHeatmap(repos, container) {
  container.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", "Contribution fallback heatmap");
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  container.appendChild(canvas);

  function computeGrid() {
    const weeks = 53;
    const days = 7;
    const grid = Array.from({ length: weeks }, () => Array(days).fill(0));
    const now = Date.now();
    repos.forEach((r, idx) => {
      const t = new Date(r.pushed_at || r.created_at || Date.now()).getTime();
      const daysAgo = Math.floor((now - t) / 86400000);
      const weekIdx = Math.max(0, weeks - 1 - Math.floor(daysAgo / 7));
      const dayIdx = Math.min(days - 1, Math.floor(daysAgo % 7));
      for (
        let w = Math.max(0, weekIdx - 2);
        w <= Math.min(weeks - 1, weekIdx + 2);
        w++
      ) {
        for (
          let d = Math.max(0, dayIdx - 1);
          d <= Math.min(days - 1, dayIdx + 1);
          d++
        ) {
          grid[w][d] +=
            (1 + Math.random() * 2) * (1 + (r.stargazers_count || 0) / 10);
        }
      }
    });
    const flat = grid.flat();
    const max = Math.max(...flat, 1);
    return { grid, max, weeks, days };
  }

  function render() {
    const rect = container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cellSize = Math.max(6, Math.floor(rect.width / 60));
    const weeks = 53;
    const days = 7;
    canvas.width = rect.width * dpr;
    canvas.height = (cellSize * days + 20) * dpr;
    canvas.style.height = cellSize * days + 20 + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { grid, max } = computeGrid();
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < days; d++) {
        const x = w * (cellSize + 2);
        const y = d * (cellSize + 2);
        const val = grid[w][d] || 0;
        const norm = Math.min(1, val / max);
        const alpha = 0.12 + 0.88 * norm;
        ctx.fillStyle = `rgba(16,185,129, ${alpha.toFixed(2)})`;
        ctx.fillRect(x, y, cellSize, cellSize);
        if (norm > 0.15) {
          ctx.fillStyle = `rgba(0,0,0,${0.07 * norm})`;
          ctx.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
        }
      }
    }

    ctx.fillStyle = "rgba(148,163,184,0.55)";
    ctx.font =
      '12px system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue"';
    ctx.fillText("Fallback heatmap — approximate", 2, canvas.height / dpr - 4);
  }

  const ro = new ResizeObserver(render);
  ro.observe(container);
  render();
}

function renderForceGraph(repos, container) {
  container.innerHTML = "";
  const w = Math.max(600, container.clientWidth);
  const h = 420;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  container.appendChild(svg);

  const N = Math.min(28, repos.length);
  const nodes = repos.slice(0, N).map((r, i) => ({
    id: r.name,
    repo: r,
    r: 6 + Math.min(30, Math.sqrt((r.stargazers_count || 0) * 2)),
    x: Math.random() * w,
    y: Math.random() * h,
    vx: 0,
    vy: 0,
  }));

  const langMap = {};
  nodes.forEach((n) => {
    const lang = n.repo.language || "Other" || "Other";
    if (!langMap[lang]) langMap[lang] = [];
    langMap[lang].push(n);
  });

  const links = [];
  Object.values(langMap).forEach((group) => {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        links.push({ source: group[i], target: group[j], strength: 0.02 });
      }
    }
  });

  const linkGroup = document.createElementNS(svg.namespaceURI, "g");
  linkGroup.setAttribute("stroke", "rgba(148,163,184,0.12)");
  svg.appendChild(linkGroup);

  const nodeGroup = document.createElementNS(svg.namespaceURI, "g");
  svg.appendChild(nodeGroup);

  links.forEach((l) => {
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute(
      "stroke-width",
      Math.max(0.6, Math.min(2.5, 1 + l.strength * 10))
    );
    linkGroup.appendChild(line);
    l.el = line;
  });

  nodes.forEach((n) => {
    const g = document.createElementNS(svg.namespaceURI, "g");
    g.setAttribute("class", "repo-node group cursor-pointer");
    g.setAttribute("transform", `translate(${n.x},${n.y})`);
    const c = document.createElementNS(svg.namespaceURI, "circle");
    c.setAttribute("r", n.r);
    c.setAttribute("fill", "rgba(16,185,129,0.9)");
    c.setAttribute("stroke", "rgba(2,6,23,0.6)");
    c.setAttribute("stroke-width", "1");
    g.appendChild(c);
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", n.r + 6);
    label.setAttribute("y", 4);
    label.setAttribute("fill", "rgba(148,163,184,0.95)");
    label.setAttribute("font-size", "12");
    label.setAttribute(
      "class",
      "opacity-0 group-hover:opacity-100 transition-opacity"
    );
    label.textContent = n.repo.name;
    g.appendChild(label);

    g.addEventListener("mouseenter", () => {
      c.animate([{ transform: "scale(1)" }, { transform: "scale(1.25)" }], {
        duration: 220,
        fill: "forwards",
        easing: "cubic-bezier(.2,.9,.3,1)",
      });
    });
    g.addEventListener("mouseleave", () => {
      c.animate([{ transform: "scale(1.25)" }, { transform: "scale(1)" }], {
        duration: 300,
        fill: "forwards",
        easing: "cubic-bezier(.2,.9,.3,1)",
      });
    });

    g.addEventListener("click", () => {
      window.open(n.repo.html_url, "_blank");
    });

    nodeGroup.appendChild(g);
    n.el = g;
  });

  const repelStrength = 4000;
  const linkDist = 60;
  const linkStrength = 0.02;
  const damping = 0.85;

  let running = true;
  function tick() {
    if (!running) return;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i],
          b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = (Math.random() - 0.5) * 0.01;
          dy = (Math.random() - 0.5) * 0.01;
          d2 = dx * dx + dy * dy;
        }
        const dist = Math.sqrt(d2);
        const force = ((repelStrength * (a.r + b.r)) / d2) * 0.001;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    for (const l of links) {
      const a = l.source,
        b = l.target;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = dist - linkDist;
      const k = 0.0015 + l.strength * 0.01;
      const fx = (dx / dist) * diff * k;
      const fy = (dy / dist) * diff * k;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const n of nodes) {
      n.vx *= damping;
      n.vy *= damping;
      n.x += n.vx;
      n.y += n.vy;
      n.x = Math.max(n.r + 8, Math.min(w - n.r - 8, n.x));
      n.y = Math.max(n.r + 8, Math.min(h - n.r - 8, n.y));
    }

    for (const l of links) {
      l.el.setAttribute("x1", l.source.x);
      l.el.setAttribute("y1", l.source.y);
      l.el.setAttribute("x2", l.target.x);
      l.el.setAttribute("y2", l.target.y);
    }
    for (const n of nodes) {
      n.el.setAttribute("transform", `translate(${n.x},${n.y})`);
    }

    requestAnimationFrame(tick);
  }

  for (let i = 0; i < 120; i++) {
    nodes.forEach((n) => {
      n.vx *= 0.9;
      n.vy *= 0.9;
    });
  }
  tick();

  const ro = new ResizeObserver(() => {
    const rect = container.getBoundingClientRect();
    const newW = Math.max(400, rect.width);
    svg.setAttribute("viewBox", `0 0 ${newW} ${h}`);
  });
  ro.observe(container);

  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Repository network graph where nodes are repos and links connect repos with shared languages"
  );
}

function renderLanguageDonut(languages, canvasEl, legendEl) {
  canvasEl.width = canvasEl.clientWidth * (window.devicePixelRatio || 1);
  canvasEl.height =
    Math.max(240, canvasEl.clientWidth * 0.6) * (window.devicePixelRatio || 1);
  const ctx = canvasEl.getContext("2d");
  ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
  const w = canvasEl.clientWidth;
  const h = Math.max(220, canvasEl.clientWidth * 0.6);
  canvasEl.style.height = h + "px";
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, e) => s + e[1], 0) || 1;
  const centerX = w / 2;
  const centerY = h / 2;
  const radius = Math.min(w, h) / 3;

  const colors = entries.map((_, i) => `hsl(${(i * 57) % 360} 70% 50%)`);
  let start = -Math.PI / 2;
  entries.forEach(([name, bytes], i) => {
    const slice = (bytes / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, start + slice);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    start += slice;
  });

  ctx.beginPath();
  ctx.fillStyle = "rgba(10,14,20,0.95)";
  ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(148,163,184,0.95)";
  ctx.textAlign = "center";
  ctx.font = "bold 14px system-ui, -apple-system, Segoe UI, Roboto";
  ctx.fillText("Languages", centerX, centerY + 5);

  legendEl.innerHTML = "";
  entries.slice(0, 8).forEach(([name, bytes], i) => {
    const el = document.createElement("div");
    el.className = "flex items-center gap-2";
    const sw = document.createElement("span");
    sw.className = "inline-block w-3 h-3 rounded";
    sw.style.background = colors[i];
    sw.setAttribute("aria-hidden", "true");
    const txt = document.createElement("div");
    txt.className = "truncate";
    txt.textContent = `${name} — ${Math.round((bytes / total) * 100)}%`;
    el.appendChild(sw);
    el.appendChild(txt);
    legendEl.appendChild(el);
  });

  const ro = new ResizeObserver(() =>
    renderLanguageDonut(languages, canvasEl, legendEl)
  );
  ro.observe(canvasEl.parentElement);
}

const statusEl = $("status");
const cachedEl = $("cached");
const lastFetchEl = $("lastFetch");
const avatarEl = $("avatar");
const displayNameEl = $("displayName");
const loginEl = $("login");
const heatmapWrap = $("heatmapWrap");
const forceWrap = $("forceWrap");
const topReposEl = $("topRepos");
const langCanvas = $("langCanvas");
const langLegend = $("langLegend");
const randomBtn = $("randomBtn");
const exportBtn = $("exportBtn");

async function loadProfileFlow(input, token) {
  const username = parseUsername(input);
  if (!username) {
    statusEl.textContent = "Invalid input — enter a username or URL.";
    return;
  }
  history.replaceState({}, "", `#user=${username}`);

  statusEl.textContent = `Loading ${username}…`;
  const cached = await getCached(username).catch(() => null);
  if (cached) {
    statusEl.textContent = `Showing cached data for ${username} — updating in background`;
    cachedEl.textContent = "yes";
    lastFetchEl.textContent = new Date(cached.timestamp).toLocaleString();
    applyPayload(username, cached.payload, true);
    backgroundRevalidate(username, token);
    return;
  } else {
    cachedEl.textContent = "no";
    lastFetchEl.textContent = "—";
  }

  try {
    const { user, repos } = await fetchUserAndRepos(username, token);
    const languages = await fetchLanguagesForTop(repos, token, 12);
    const payload = { user, repos, languages, fetchedAt: Date.now() };
    await setCached(username, payload);
    lastFetchEl.textContent = new Date().toLocaleString();
    applyPayload(username, payload, false);
    statusEl.textContent = `Loaded ${username}`;
  } catch (e) {
    if (e && e.status === 404) {
      statusEl.textContent = `User not found: ${username}`;
    } else if (e && e.status === 403) {
      statusEl.textContent = `Rate limit or permission issue — provide a token to increase limits.`;
    } else {
      console.error(e);
      statusEl.textContent = "Failed to fetch data — see console for details.";
    }
  }
}

async function backgroundRevalidate(username, token) {
  try {
    const { user, repos } = await fetchUserAndRepos(username, token);
    const languages = await fetchLanguagesForTop(repos, token, 12);
    const payload = { user, repos, languages, fetchedAt: Date.now() };
    await setCached(username, payload);
    const currentHash = new URLSearchParams(location.hash.replace("#", ""));
    if (location.hash.includes(`user=${username}`)) {
      applyPayload(username, payload, false);
      statusEl.textContent = `Background data refreshed for ${username}`;
      lastFetchEl.textContent = new Date().toLocaleString();
      cachedEl.textContent = "yes";
    }
  } catch (e) {
    console.debug("Background refresh failed", e);
  }
}

async function applyPayload(username, payload, isCache) {
  const { user, repos, languages } = payload;
  avatarEl.src = user.avatar_url || "";
  avatarEl.alt = `${user.login || username}'s avatar`;
  displayNameEl.textContent = user.name || user.login || username;
  displayNameEl.title = user.name ? `${user.name} — ${user.login}` : user.login;
  loginEl.textContent = user.bio || user.login || "";

  await renderOverviewSection(user, repos);

  const svgText = await fetchContribSvg(username).catch(() => null);
  if (svgText) {
    try {
      injectContribSvg(svgText, heatmapWrap);
    } catch (e) {
      drawFallbackHeatmap(repos, heatmapWrap);
    }
  } else {
    drawFallbackHeatmap(repos, heatmapWrap);
  }

  if (repos && repos.length > 0) {
    renderForceGraph(repos, forceWrap);
  } else {
    forceWrap.innerHTML =
      '<div class="text-slate-400 text-sm">No repos available</div>';
  }

  topReposEl.innerHTML = "";
  const sorted = [...repos].sort(
    (a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0)
  );
  sorted.slice(0, 8).forEach((r) => {
    const li = document.createElement("li");
    li.className =
      "p-3 rounded-md bg-slate-900/30 border border-slate-700 flex justify-between items-start gap-3 hover:scale-[1.01] transition-transform";
    const left = document.createElement("div");
    left.className = "min-w-0";
    const name = document.createElement("div");
    name.className = "font-semibold truncate max-w-[28rem]";
    name.textContent = r.name;
    name.title = r.name;
    const desc = document.createElement("div");
    desc.className = "text-xs text-slate-400 truncate";
    desc.textContent = r.description || "";
    left.appendChild(name);
    left.appendChild(desc);

    const right = document.createElement("div");
    right.className = "flex flex-col items-end gap-2";
    const star = document.createElement("div");
    star.className = "text-xs";
    star.innerHTML = `★ ${r.stargazers_count || 0}`;
    const lang = document.createElement("div");
    lang.className = "text-xs text-slate-400";
    lang.textContent = r.language || "—";
    right.appendChild(star);
    right.appendChild(lang);

    li.appendChild(left);
    li.appendChild(right);
    li.addEventListener("click", () => window.open(r.html_url, "_blank"));
    topReposEl.appendChild(li);
  });

  const langTotals =
    payload.languages && Object.keys(payload.languages).length
      ? payload.languages
      : {};
  if (Object.keys(langTotals).length === 0) {
    const agg = {};
    repos.forEach((r) => {
      const l = r.language || "Other";
      agg[l] = (agg[l] || 0) + 1;
    });
    renderLanguageDonut(agg, langCanvas, langLegend);
  } else {
    renderLanguageDonut(langTotals, langCanvas, langLegend);
  }

  Array.from(
    document.querySelectorAll("#overview .rounded-xl, #topRepos > li")
  ).forEach((el, idx) => {
    el.animate(
      [
        { transform: "translateY(10px) scale(.995)", opacity: 0 },
        { transform: "translateY(0) scale(1)", opacity: 1 },
      ],
      {
        duration: 450,
        easing: "cubic-bezier(.16,1,.3,1)",
        delay: idx * 40,
        fill: "forwards",
      }
    );
  });
}

(function setup() {
  const form = $("profileForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = $("profileInput").value;
    const token = $("tokenInput").value || null;
    await loadProfileFlow(input, token);
  });

  randomBtn.addEventListener("click", async () => {
    const examples = [
      "sindresorhus",
      "gaearon",
      "torvalds",
      "yyx990803",
      "tj",
      "defunkt",
      "octocat",
      "addaleax",
    ];
    const choice = examples[Math.floor(Math.random() * examples.length)];
    $("profileInput").value = choice;
    await loadProfileFlow(choice, $("tokenInput").value || null);
  });

  if (location.hash && location.hash.includes("user=")) {
    const u = new URLSearchParams(location.hash.replace("#", "")).get("user");
    if (u) {
      $("profileInput").value = u;
      const token = sessionStorage.getItem("gh_token") || "";
      if (token) $("tokenInput").value = token;
      loadProfileFlow(u, token);
    }
  }

  $("tokenInput").addEventListener("change", (e) => {
    const v = e.target.value || "";
    if (v) sessionStorage.setItem("gh_token", v);
    else sessionStorage.removeItem("gh_token");
  });

  const header = $("siteHeader");
  header.addEventListener("mousemove", (ev) => {
    const rect = header.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (ev.clientX - cx) / rect.width;
    const dy = (ev.clientY - cy) / rect.height;
    const brand = $("brand");
    brand.style.transform = `translate3d(${dx * 6}px, ${dy * 6}px, 0)`;
  });
  header.addEventListener("mouseleave", () => {
    const brand = $("brand");
    brand.style.transform = "";
  });

  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    exportBtn.textContent = "Exporting…";
    try {
      const svgNode = forceWrap.querySelector("svg");
      const heatmapNode =
        heatmapWrap.querySelector("svg") || heatmapWrap.querySelector("canvas");
      const canvases = [langCanvas];
      const cw = Math.min(1600, document.documentElement.clientWidth);
      const ch = 1200;
      const out = document.createElement("canvas");
      out.width = cw * (window.devicePixelRatio || 1);
      out.height = ch * (window.devicePixelRatio || 1);
      const ctx = out.getContext("2d");
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
      ctx.fillStyle = "#071023";
      ctx.fillRect(0, 0, cw, ch);

      let x = 20,
        y = 20;
      async function drawSvgToCanvas(svgEl, targetX, targetY, maxW) {
        if (!svgEl) return;
        const svgStr = new XMLSerializer().serializeToString(svgEl);
        const svg64 =
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);
        const img = new Image();
        img.src = svg64;
        await new Promise((r) => (img.onload = r));
        const scale = Math.min(1, maxW / img.width);
        const w = img.width * scale,
          h = img.height * scale;
        ctx.drawImage(img, targetX, targetY, w, h);
      }
      if (svgNode) await drawSvgToCanvas(svgNode, x, y, Math.min(900, cw - 40));
      y += 360;
      if (heatmapNode && heatmapNode.tagName === "svg") {
        await drawSvgToCanvas(heatmapNode, 20, y, Math.min(cw - 40, 900));
      } else if (heatmapNode && heatmapNode.tagName === "CANVAS") {
        ctx.drawImage(
          heatmapNode,
          20,
          y,
          Math.min(cw - 40, heatmapNode.width / (window.devicePixelRatio || 1))
        );
      }
      const lc = langCanvas;
      if (lc)
        ctx.drawImage(
          lc,
          cw - lc.width / (window.devicePixelRatio || 1) - 20,
          ch - lc.height / (window.devicePixelRatio || 1) - 20
        );
      const url = out.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `gh-dashboard-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      console.error(e);
      alert("Export failed — see console.");
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = "Export visuals";
    }
  });
})();
