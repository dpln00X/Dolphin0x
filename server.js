```js
// server.js
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();
const db = new Database("database.sqlite");

// Tabellen (blijven bestaan in database.sqlite)
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

// Special admin login (alleen dit kan posten)
const ADMIN_USER = "specialAdmin";
const ADMIN_PASS = "admin123"; // <-- wijzig dit

const existing = db.prepare("SELECT * FROM users WHERE username=?").get(ADMIN_USER);
if (!existing) {
const hash = bcrypt.hashSync(ADMIN_PASS, 10);
db.prepare("INSERT INTO users (username, password_hash) VALUES (?,?)").run(ADMIN_USER, hash);
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
session({
secret: "maak-een-stevige-secret",
resave: false,
saveUninitialized: false,
})
);

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

fs.mkdirSync("uploads", { recursive: true });
const upload = multer({ dest: "uploads/" });

function requireAdmin(req, res, next) {
if (req.session && req.session.admin === true) return next();
res.status(401).send("Niet geautoriseerd. Login als admin.");
}

app.get("/", (req, res) => {
const posts = db.prepare("SELECT * FROM posts ORDER BY id DESC").all();
res.render("index", { posts });
});

app.get("/admin/login", (req, res) => {
res.render("login", { error: "" });
});

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

app.get("/admin", requireAdmin, (req, res) => {
res.render("admin", { error: "" });
});

app.post("/admin/post", requireAdmin, upload.single("image"), (req, res) => {
const { title, content } = req.body;
const imagePath = req.file ? `/uploads/${path.basename(req.file.path)}` : null;

if (!title || !content) return res.status(400).send("Titel en tekst zijn verplicht.");

db.prepare("INSERT INTO posts (title, content, image_path) VALUES (?,?,?)").run(
title,
content,
imagePath
);