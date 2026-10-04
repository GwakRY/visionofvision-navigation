"""Offline API contract tests: AWS and MySQL are mocked; no credentials needed."""
import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

import mysql.connector


SOURCE = Path(__file__).resolve().parents[1] / "backend/favorites/favorites.py"
spec = importlib.util.spec_from_file_location("favorites_under_test", SOURCE)
favorites = importlib.util.module_from_spec(spec)
with patch.dict(os.environ), patch("boto3.client") as client:
    client.return_value.get_parameter.return_value = {"Parameter": {"Value": "test-only"}}
    spec.loader.exec_module(favorites)


class FavoritesTests(unittest.TestCase):
    def setUp(self):
        favorites.app.config.update(TESTING=True)
        favorites.app.logger.disabled = True
        self.client = favorites.app.test_client()
        self.db = MagicMock()
        self.cursor = self.db.cursor.return_value
        self.cursor.rowcount = 1
        self.cursor.fetchone.return_value = {"favorite_id": 7}
        self.cursor.fetchall.return_value = [{"favorite_id": 7, "device_id": "device-a"}]
        self.connection_patch = patch.object(favorites, "connection", return_value=self.db)
        self.connect = self.connection_patch.start()
        self.addCleanup(self.connection_patch.stop)
        self.body = {"name": "Station", "address": "Seoul"}

    def request(self, method):
        if method == "GET":
            return self.client.get("/setting/favorites?device_id=device-a")
        if method == "POST":
            return self.client.post("/setting/favorites", json={**self.body, "deviceId": "device-a"})
        if method == "PUT":
            return self.client.put("/setting/favorites/7", json={**self.body, "device_id": "device-a"})
        return self.client.delete("/setting/favorites/7", headers={"Device-ID": "device-a"})

    def assert_closed(self):
        self.cursor.close.assert_called_once()
        self.db.close.assert_called_once()

    def test_get_device_scoped_array(self):
        response = self.request("GET")
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json, list)
        self.cursor.execute.assert_called_once_with(
            "SELECT * FROM favorites WHERE device_id = %s", ("device-a",)
        )
        self.db.commit.assert_not_called()
        self.assert_closed()

    def test_post_and_put_return_only_request_device(self):
        for method in ("POST", "PUT"):
            with self.subTest(method=method):
                self.db.reset_mock()
                self.cursor.execute.side_effect = None
                def select(sql, params):
                    if sql.startswith("SELECT *"):
                        self.cursor.fetchall.return_value = [
                            row for row in (
                                {"favorite_id": 7, "device_id": "device-a"},
                                {"favorite_id": 8, "device_id": "device-b"},
                            ) if "WHERE device_id = %s" in sql and row["device_id"] == params[0]
                        ]
                self.cursor.execute.side_effect = select
                response = self.request(method)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json, [{"favorite_id": 7, "device_id": "device-a"}])
                self.cursor.execute.assert_any_call(
                    "SELECT * FROM favorites WHERE device_id = %s", ("device-a",)
                )
                self.db.commit.assert_called_once()
                self.db.rollback.assert_not_called()
                self.assert_closed()

    def test_invalid_requests_fail_before_opening_db(self):
        requests = [
            ("GET", "/setting/favorites", {}),
            ("GET", "/setting/favorites?device_id=%20", {}),
            ("DELETE", "/setting/favorites/7", {}),
        ]
        for method in ("POST", "PUT"):
            url = "/setting/favorites" if method == "POST" else "/setting/favorites/7"
            device_field = "deviceId" if method == "POST" else "device_id"
            for body in (None, [], "text", {}, {**self.body, device_field: 1},
                         {**self.body, device_field: " "},
                         {"name": "", "address": "Seoul", device_field: "device-a"},
                         {"name": "Station", "address": None, device_field: "device-a"}):
                requests.append((method, url, {"json": body}))
            requests.append((method, url, {"data": "{broken", "content_type": "application/json"}))
        for method, url, kwargs in requests:
            with self.subTest(method=method, kwargs=kwargs):
                response = self.client.open(url, method=method, **kwargs)
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.json)
        self.connect.assert_not_called()

    def test_sql_like_input_remains_bound_parameter(self):
        text = "x'; DROP TABLE favorites; --"
        response = self.client.post("/setting/favorites", json={
            "deviceId": "device-a", "name": text, "address": "Seoul"
        })
        self.assertEqual(response.status_code, 200)
        sql, params = self.cursor.execute.call_args_list[0].args
        self.assertNotIn(text, sql)
        self.assertEqual(params, ("Seoul", text, "device-a"))

    def test_unchanged_put_is_not_missing(self):
        self.cursor.rowcount = 0
        self.assertEqual(self.request("PUT").status_code, 200)
        self.cursor.execute.assert_any_call(
            "SELECT favorite_id FROM favorites WHERE favorite_id = %s AND device_id = %s FOR UPDATE",
            (7, "device-a"),
        )
        self.db.commit.assert_called_once()

    def test_put_missing_or_other_device_target_is_404(self):
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.request("PUT").status_code, 404)
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_called_once()
        self.assert_closed()

    def test_delete_keeps_empty_array_contract(self):
        response = self.request("DELETE")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, [])
        self.cursor.execute.assert_called_once_with(
            "DELETE FROM favorites WHERE favorite_id = %s AND device_id = %s", (7, "device-a")
        )
        self.db.commit.assert_called_once()
        self.assert_closed()

    def test_missing_delete_rolls_back(self):
        self.cursor.rowcount = 0
        self.assertEqual(self.request("DELETE").status_code, 404)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_called_once()
        self.assert_closed()

    def test_query_failures_cleanup_and_do_not_expose_db_details(self):
        for method in ("GET", "POST", "PUT", "DELETE"):
            with self.subTest(method=method):
                self.db.reset_mock()
                self.cursor.execute.side_effect = mysql.connector.Error("private DB details")
                response = self.request(method)
                self.assertEqual(response.status_code, 500)
                self.assertEqual(response.json, {"error": "Database operation failed"})
                self.db.commit.assert_not_called()
                if method == "GET":
                    self.db.rollback.assert_not_called()
                else:
                    self.db.rollback.assert_called_once()
                self.assert_closed()

    def test_post_readback_failure_rolls_back_before_commit(self):
        self.cursor.fetchall.side_effect = mysql.connector.Error("read failed")
        self.assertEqual(self.request("POST").status_code, 500)
        self.db.commit.assert_not_called()
        self.db.rollback.assert_called_once()
        self.assert_closed()

    def test_commit_failure_rolls_back(self):
        self.db.commit.side_effect = mysql.connector.Error("commit failed")
        self.assertEqual(self.request("POST").status_code, 500)
        self.db.rollback.assert_called_once()
        self.assert_closed()

    def test_cursor_creation_failure_closes_connection(self):
        self.db.cursor.side_effect = mysql.connector.Error("cursor failed")
        self.assertEqual(self.request("POST").status_code, 500)
        self.db.rollback.assert_called_once()
        self.db.close.assert_called_once()

    def test_connection_failure_returns_generic_error(self):
        self.connect.side_effect = mysql.connector.Error("connection failed")
        self.assertEqual(self.request("GET").status_code, 500)
        self.db.cursor.assert_not_called()

    def test_close_and_rollback_failures_still_close_connection(self):
        self.cursor.execute.side_effect = mysql.connector.Error("query failed")
        self.db.rollback.side_effect = mysql.connector.Error("rollback failed")
        self.cursor.close.side_effect = mysql.connector.Error("close failed")
        self.assertEqual(self.request("POST").status_code, 500)
        self.assert_closed()


if __name__ == "__main__":
    unittest.main()
