"""Favorites API; device_id scopes data but is not an authentication credential."""
from contextlib import contextmanager
import os

import boto3
from flask import Flask, jsonify, request
import mysql.connector
from werkzeug.exceptions import BadRequest, NotFound


def load_ssm_to_env(param_map, region="ap-northeast-2"):
    ssm = boto3.client("ssm", region_name=region)
    for env_name, ssm_name in param_map.items():
        response = ssm.get_parameter(Name=ssm_name, WithDecryption=True)
        os.environ[env_name] = response["Parameter"]["Value"]


PARAMS = {
    "authHost": "/db/host",
    "authUser": "/db/user",
    "authPassword": "/db/password",
    "authDatabase": "/db/database",
}
load_ssm_to_env(PARAMS)

authHost = os.getenv("authHost")
authUser = os.getenv("authUser")
authPassword = os.getenv("authPassword")
authDatabase = os.getenv("authDatabase")
app = Flask(__name__)


def connection():
    return mysql.connector.connect(
        host=authHost, user=authUser, password=authPassword, database=authDatabase
    )


def close(cursor, db_connection):
    # A failed cursor close must not prevent closing the connection.
    for resource in (cursor, db_connection):
        if resource is not None:
            try:
                resource.close()
            except mysql.connector.Error:
                app.logger.exception("DB resource cleanup failed")


@contextmanager
def database_cursor(write=False):
    db_connection = None
    cursor = None
    try:
        db_connection = connection()
        cursor = db_connection.cursor(dictionary=True)
        yield cursor
        if write:
            db_connection.commit()
    except Exception:
        if write and db_connection is not None:
            try:
                db_connection.rollback()
            except mysql.connector.Error:
                app.logger.exception("DB rollback failed")
        raise
    finally:
        close(cursor, db_connection)


def required_text(value, field):
    if not isinstance(value, str) or not value.strip():
        raise BadRequest(f"{field} must be a non-empty string")
    return value


def favorite_body(device_field):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("A JSON object is required")
    return (
        required_text(data.get(device_field), device_field),
        required_text(data.get("name"), "name"),
        required_text(data.get("address"), "address"),
    )


def list_favorites(cursor, device_id):
    cursor.execute("SELECT * FROM favorites WHERE device_id = %s", (device_id,))
    return cursor.fetchall()


@app.errorhandler(BadRequest)
@app.errorhandler(NotFound)
def handle_request_error(error):
    return jsonify(error=error.description), error.code


@app.errorhandler(mysql.connector.Error)
def handle_database_error(error):
    app.logger.exception("Favorites database operation failed")
    return jsonify(error="Database operation failed"), 500


@app.route("/setting/favorites", methods=["GET"])
def getFavoritesList():
    device_id = required_text(request.args.get("device_id"), "device_id")
    with database_cursor() as cursor:
        output = list_favorites(cursor, device_id)
    return jsonify(output)


@app.route("/setting/favorites", methods=["POST"])
def createFavorite():
    # Preserve the original POST deviceId field.
    device_id, name, address = favorite_body("deviceId")
    with database_cursor(write=True) as cursor:
        cursor.execute(
            """INSERT INTO favorites(address, name, device_id)
               VALUES (%s, %s, %s)
               ON DUPLICATE KEY UPDATE address = VALUES(address), name = VALUES(name)""",
            (address, name, device_id),
        )
        output = list_favorites(cursor, device_id)
    return jsonify(output)


@app.route("/setting/favorites/<int:id>", methods=["PUT"])
def changeFavorite(id):
    device_id, name, address = favorite_body("device_id")
    with database_cursor(write=True) as cursor:
        # Check existence separately: an unchanged UPDATE can report rowcount=0.
        cursor.execute(
            "SELECT favorite_id FROM favorites WHERE favorite_id = %s AND device_id = %s FOR UPDATE",
            (id, device_id),
        )
        if cursor.fetchone() is None:
            raise NotFound("Favorite not found")
        cursor.execute(
            "UPDATE favorites SET address = %s, name = %s WHERE favorite_id = %s AND device_id = %s",
            (address, name, id, device_id),
        )
        output = list_favorites(cursor, device_id)
    return jsonify(output)


@app.route("/setting/favorites/<int:id>", methods=["DELETE"])
def deleteFavorite(id):
    device_id = required_text(request.headers.get("Device-ID"), "Device-ID")
    with database_cursor(write=True) as cursor:
        cursor.execute(
            "DELETE FROM favorites WHERE favorite_id = %s AND device_id = %s",
            (id, device_id),
        )
        if cursor.rowcount == 0:
            raise NotFound("Favorite not found")
    # Preserve the original successful DELETE response rather than change its contract.
    return jsonify([])


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5010, debug=False, use_reloader=False)
