# -*- coding: utf-8 -*-
"""pytest 全局配置：在导入应用前把 DB 指向临时文件，隔离真实数据."""
import os
import sys
import tempfile
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 必须在 import minio_server / db 之前设置
_TMP = tempfile.mkdtemp(prefix="rs_test_")
os.environ.setdefault("RS_DB_FILE", os.path.join(_TMP, "test.db"))


import pytest  # noqa: E402


@pytest.fixture(scope="session")
def app():
    import minio_server
    return minio_server.app


@pytest.fixture()
def client(app):
    return app.test_client()
