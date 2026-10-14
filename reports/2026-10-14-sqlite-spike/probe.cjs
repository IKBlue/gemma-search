
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const out = [];
const dir = __dirname;
const dbPath = path.join(dir, '_sqlite-probe.db');
const clean = () => { for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) { try { fs.unlinkSync(f); } catch {} } };
app.whenReady().then(() => {
  try {
    out.push('process.type = ' + process.type);
    out.push('node = ' + process.versions.node + ' · electron = ' + process.versions.electron + ' · chrome = ' + process.versions.chrome);
    const { DatabaseSync } = require('node:sqlite');
    out.push('require("node:sqlite") = OK · DatabaseSync = ' + typeof DatabaseSync);
    clean();
    const db = new DatabaseSync(dbPath);
    out.push('journal_mode = ' + db.prepare('PRAGMA journal_mode=WAL').get().journal_mode);
    db.exec('CREATE TABLE items(uid TEXT PRIMARY KEY, rel_path TEXT, sha1 TEXT)');
    const ins = db.prepare('INSERT INTO items VALUES (?,?,?)');
    ins.run('a1', 'CR/x.jpg', 'deadbeef');
    ins.run('b2', 'VR/y.jpg', 'cafebabe');
    out.push('插入后行数 = ' + db.prepare('SELECT count(*) AS n FROM items').get().n);
    const dup = db.prepare('SELECT sha1, count(*) c FROM items GROUP BY sha1 HAVING c>1').all();
    out.push('重复检测 SQL (group by having) = OK · 结果 ' + dup.length + ' 组');
    out.push('WAL 文件存在 = ' + fs.existsSync(dbPath + '-wal') + ' · SHM 存在 = ' + fs.existsSync(dbPath + '-shm'));
    db.close();
    out.push('close() = OK');
    clean();
    const db2 = new DatabaseSync(dbPath);
    db2.exec('CREATE TABLE t(x)');
    out.push('删除后重建 = OK（.gs.db 可重建这条成立）');
    db2.close();
    clean();
    out.push('RESULT = PASS');
  } catch (e) {
    out.push('RESULT = FAIL');
    out.push(String((e && e.stack) || e));
  }
  fs.writeFileSync(path.join(dir, '_sqlite-probe.txt'), out.join('\n') + '\n', 'utf8');
  app.exit(0);
});
