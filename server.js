```js
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();

// Persistent storage (liefst op Render; valt terug naar projectmap)
const storageDir = process.env.STORAGE_DIR || __dirname;
fs.mkdirSync(path.join(storageDir, "uploads"), { recursive: true });

const db = new Database(path.join(storageDir, "database.sqlite"));

db.exec(`
CREATE TABLE IF NOT EXISTS users (
id INTEGER PRIMARY KEY AUTOINCREMENT,
username TEXT UNIQUE,
password_hash TEXT
);

CREATE TABLE IF NOT EXISTS posts (
id INTEGER PRIMARY KEY AUTOINCREMENT,
title TEXT,
content TEXT,
image_path TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comments (
id INTEGER PRIMARY KEY AUTOINCREMENT,
post_id INTEGER,
content TEXT,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY(post_id) REFERENCES posts(id)
);
`);

const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET || "secret";

if (!ADMIN_USER || !ADMIN_PASS) {
console.error("Missing ADMIN_USER/ADMIN_PASS in .env");
process.exit(1);
}

// Zet admin user aan als die nog niet bestaat
const existing = db.prepare("SELECT * FROM users WHERE username=?").get(ADMIN_USER);
if (!existing) {
const hash = bcrypt.hashSync(ADMIN_PASS, 10);
db.prepare("INSERT INTO users (username, password_hash) VALUES (?,?)").run(ADMIN_USER, hash);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
session({
secret: SESSION_SECRET,
resave: false,
saveUninitialized: false,
})
);

// Uploads static
const uploadsPublic = path.join(storageDir, "uploads");
app.use("/uploads", express.static(uploadsPublic));

// Multer: upload naar persistent dir
const upload = multer({ dest: uploadsPublic });

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

function requireAdmin(req, res, next) {
if (req.session && req.session.admin === true) return next();
res.status(401).send("Niet geautoriseerd. Login als admin.");
}

app.get("/", (req, res) => {
const posts = db.prepare("SELECT * FROM posts ORDER BY id DESC").all();
res.render("index", { posts });
});

app.get("/admin/login", (req, res) => res.render("login", { error: "" }));

app.post("/admin/login", (req, res) => {
const { username, password } = req.body;
const user = db.prepare("SELECT * FROM users WHERE username=?").get(username);
if (!user) return res.render("login", { error: "Fout username of password" });

const ok = bcrypt.compareSync(password, user.password_hash);
if (!ok) return res.render("login", { error: "Fout username of password" });

req.session.admin = true;
res.redirect("/admin");
});

app.get("/admin/logout", (req, res) => {
req.session.destroy(() => res.redirect("/"));
});

app.get("/admin", requireAdmin, (req, res) => res.render("admin", { error: "" }));

app.post("/admin/post", requireAdmin, upload.single("image"), (req, res) => {
const { title, content } = req.body;
if (!title || !content) return res.status(400).send("Titel en tekst zijn verplicht.");

const imagePath = req.file ? `/uploads/${path.basename(req.file.path)}` : null;

db.prepare("INSERT INTO posts (title, content, image_path) VALUES (?,?,?)").run(
title,
content,
imagePath
);

res.redirect("/");
});

app.post("/comment", (req, res) => {
const { postId, content } = req.body;
if (!content) return res.status(400).send("Bericht is verplicht.");

db.prepare("INSERT INTO comments (post_id, content) VALUES (?,?)").run(postId, content);
res.redirect(`/post/${postId}`);
});

app.get("/post/:id", (req, res) => {
const post = db.prepare("SELECT * FROM posts WHERE id=?").get(req.params.id);
if (!post) return res.status(404).send("Post niet gevonden.");

const comments = db
.prepare("SELECT * FROM comments WHERE post_id=? ORDER BY id ASC")
.all(req.params.id);

res.render("post", { post, comments });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Ga naar http://localhost:${PORT}`));
```