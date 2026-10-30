# -*- coding: utf-8 -*-
"""资源管理 API 核心路径测试（Flask test client，临时库）."""
import uuid


def _uniq(prefix="t"):
    return prefix + uuid.uuid4().hex[:8]


# ---------- 菜单 ----------

def test_menu_list(client):
    r = client.get("/rs/menu/list")
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True
    assert body["data"], "菜单不应为空"


# ---------- URL CRUD ----------

def test_url_crud_roundtrip(client):
    name, url = _uniq("名字"), "https://example.com/" + _uniq()
    # 创建
    r = client.post("/rs/url", json={"name": name, "url": url})
    assert r.status_code == 200 and r.get_json()["ok"] is True
    rid = r.get_json()["id"]
    # 列表可见
    rows = client.get("/rs/url/list?page=1&pageSize=1000").get_json()["data"]["rows"]
    assert any(x["id"] == rid for x in rows)
    # 更新
    r = client.put(f"/rs/url/{rid}", json={"name": name + "-v2"})
    assert r.get_json()["ok"] is True
    rows = client.get("/rs/url/list?page=1&pageSize=1000").get_json()["data"]["rows"]
    assert next(x for x in rows if x["id"] == rid)["name"] == name + "-v2"
    # 删除
    r = client.delete(f"/rs/url/{rid}")
    assert r.get_json()["ok"] is True
    rows = client.get("/rs/url/list?page=1&pageSize=1000").get_json()["data"]["rows"]
    assert not any(x["id"] == rid for x in rows)


# ---------- URL 协议白名单 ----------

def test_url_reject_dangerous_scheme(client):
    for bad in ("javascript:alert(1)", "JavaScript:alert(1)",
                "data:text/html,<script>x</script>", "vbscript:msgbox(1)",
                "ftp://example.com/x"):
        r = client.post("/rs/url", json={"name": _uniq(), "url": bad})
        assert r.get_json()["ok"] is False, f"应拦截: {bad}"
        assert r.status_code == 400


def test_online_doc_reject_dangerous_scheme(client):
    r = client.post("/rs/online-doc", json={"name": _uniq(), "url": "javascript:alert(1)"})
    assert r.get_json()["ok"] is False
    # 更新也不允许改成危险协议
    ok = client.post("/rs/online-doc", json={"name": _uniq(), "url": "https://ok.example.com/" + _uniq()})
    rid = ok.get_json()["id"]
    r = client.put(f"/rs/online-doc/{rid}", json={"url": "javascript:alert(2)"})
    assert r.get_json()["ok"] is False


def test_url_batch_partial_fail(client):
    good = "https://example.org/" + _uniq()
    r = client.post("/rs/url/batch", json={"items": [
        {"name": _uniq("g"), "url": good},
        {"name": _uniq("b"), "url": "javascript:alert(1)"},
    ]})
    body = r.get_json()
    assert body["success"] == 1 and body["fail"] == 1


# ---------- 分组视图（服务端聚合） ----------

def test_grouped_list_shape(client):
    r = client.get("/rs/url/list?grouped=1&catMode=three")
    body = r.get_json()
    assert body["ok"] is True
    data = body["data"]
    for k in ("total", "rows", "byCat", "counts", "truncated"):
        assert k in data, f"缺少字段 {k}"
    assert len(data["rows"]) == data["total"]


# ---------- 分类 ----------

def test_category_crud_and_recursive_delete(client):
    mod = "url_" + _uniq()
    r = client.post("/rs/category", json={"module": mod, "name": "一级" + _uniq(), "level": 1})
    assert r.get_json()["ok"] is True
    tree = client.get(f"/rs/category/{mod}").get_json()["data"]
    assert len(tree) == 1
    p = tree[0]
    r = client.post("/rs/category", json={"module": mod, "name": "二级" + _uniq(), "level": 2, "parentId": p["id"]})
    assert r.get_json()["ok"] is True
    # 删一级应级联删二级
    r = client.delete(f"/rs/category/{p['id']}")
    assert r.get_json()["ok"] is True
    tree = client.get(f"/rs/category/{mod}").get_json()["data"]
    assert tree == []


# ---------- AI 配置脱敏 + 加密 ----------

def test_ai_config_masked_and_encrypted(client, tmp_path, monkeypatch):
    import minio_server
    monkeypatch.setattr(minio_server, "AI_CONFIG_FILE", str(tmp_path / "ai.json"))
    monkeypatch.setattr(minio_server, "AI_KEY_FILE", str(tmp_path / "ai.key"))
    monkeypatch.setattr(minio_server, "ai_config_cache", {}, raising=False)

    secret = "sk-test-" + uuid.uuid4().hex
    r = client.post("/minio/api/ai/config", json={
        "base_url": "https://api.example.com/v1", "model": "m1", "api_key": secret,
    })
    assert r.status_code == 200

    # 接口返回脱敏：api_key 空、masked 存在
    g = client.get("/minio/api/ai/config").get_json()
    assert g["api_key"] == ""
    assert g.get("api_key_masked")

    # 磁盘上是密文，不含明文
    import json
    raw = json.loads((tmp_path / "ai.json").read_text())
    assert raw["api_key"].startswith("enc1$")
    assert secret not in (tmp_path / "ai.json").read_text()

    # 内存解密可用（chat 依赖）
    assert minio_server._load_ai_config()["api_key"] == secret


def test_ai_config_legacy_plaintext_upgrade(client, tmp_path, monkeypatch):
    """旧版明文配置读取后自动升级为加密存储."""
    import json
    import minio_server
    monkeypatch.setattr(minio_server, "AI_CONFIG_FILE", str(tmp_path / "legacy.json"))
    monkeypatch.setattr(minio_server, "AI_KEY_FILE", str(tmp_path / "legacy.key"))
    monkeypatch.setattr(minio_server, "ai_config_cache", {}, raising=False)

    legacy = "sk-legacy-plain"
    (tmp_path / "legacy.json").write_text(json.dumps({"api_key": legacy, "base_url": "https://x"}))
    # 读取：明文可用
    assert minio_server._load_ai_config()["api_key"] == legacy
    # 磁盘已升级为密文
    assert json.loads((tmp_path / "legacy.json").read_text())["api_key"].startswith("enc1$")


# ---------- 内置浏览器辅助 ----------

def test_browser_probe_rejects_non_http(client):
    r = client.get("/rs/browser/probe?url=" + "javascript:alert(1)")
    body = r.get_json()
    assert body["ok"] is True
    assert body["frameable"] is None


def test_browser_open_blocks_dangerous_scheme(client):
    r = client.post("/rs/browser/open", json={"url": "javascript:alert(1)"})
    assert r.get_json()["ok"] is False


# ---------- 导入（走 batch 白名单） ----------

def test_import_url_rejects_dangerous_scheme(client):
    import json as _json
    r = client.post("/rs/import/url", json={
        "format": "json",
        "text": _json.dumps({"items": [
            {"name": _uniq("i"), "url": "https://ok.example.com/" + _uniq()},
            {"name": _uniq("j"), "url": "javascript:alert(1)"},
        ]}),
    })
    body = r.get_json()
    assert body["success"] == 1 and body["fail"] == 1
