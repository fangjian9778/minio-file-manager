# -*- coding: utf-8 -*-
"""schema_version 迁移机制测试."""


def test_baseline_version():
    import db
    conn = db._get_conn()
    assert db._get_version(conn) == db.SCHEMA_VERSION


def test_migration_applies_in_order():
    import db
    conn = db._get_conn()
    before = db._get_version(conn)
    target = before + 1
    orig = dict(db.MIGRATIONS)
    try:
        db.MIGRATIONS[target] = ["ALTER TABLE url_item ADD COLUMN test_mig_col TEXT DEFAULT ''"]
        ver = db.migrate()
        assert ver == target
        cols = [r[1] for r in conn.execute("PRAGMA table_info(url_item)").fetchall()]
        assert "test_mig_col" in cols
        assert db._get_version(conn) == target
        # 重复调用幂等（版本已到，不再执行）
        assert db.migrate() == target
    finally:
        db.MIGRATIONS.clear()
        db.MIGRATIONS.update(orig)


def test_rs_db_file_env_override():
    import os
    import db
    # conftest 已通过 RS_DB_FILE 指向临时目录
    assert os.environ.get("RS_DB_FILE")
    assert db.DB_FILE == os.path.abspath(os.environ["RS_DB_FILE"])
