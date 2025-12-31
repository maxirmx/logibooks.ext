import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 5177;

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const id = (req.body?.id || "noid").replace(/[^a-zA-Z0-9_-]/g, "_");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = (file.originalname || "image.png").split(".").pop() || "png";
    cb(null, `${id}-${ts}.${ext}`);
  }
});
const upload = multer({ storage });

/**
 * Simulation job queue: URLs are from an allow-list and served one-by-one.
 * End marker: { end: true }
 */
const base = `http://localhost:${PORT}`;
const queue = [
  { id: "job-001", url: `${base}/page1.html` },
  { id: "job-002", url: `${base}/page2.html` },
  { id: "job-003", url: `${base}/page1.html#variant` }
];

app.get("/next", (_req, res) => {
  const item = queue.shift();
  if (!item) return res.json({ end: true });
  res.json({ end: false, ...item });
});

app.post("/upload", upload.single("image"), (req, res) => {
  // For debugging: store rect/url/id metadata in a .json next to the image.
  const meta = {
    receivedAt: new Date().toISOString(),
    id: req.body?.id,
    url: req.body?.url,
    rect: safeJsonParse(req.body?.rect),
    file: req.file?.filename
  };

  if (req.file?.filename) {
    const metaPath = path.join(uploadDir, `${req.file.filename}.json`);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  }

  res.json({ ok: true, meta });
});

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.send(`Sim server running on ${base}`));

app.listen(PORT, () => console.log(`Sim server: ${base}`));
