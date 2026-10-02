from flask import Flask, jsonify, request
import mysql.connector
import boto3
import os

def load_ssm_to_env(param_map, region="ap-northeast-2"):
    ssm = boto3.client('ssm', region_name=region)
    for env_name, ssm_name in param_map.items():
        response = ssm.get_parameter(Name=ssm_name, WithDecryption=True)
        os.environ[env_name] = response['Parameter']['Value']

# 불러올 SSM 파라미터 이름 매핑
PARAMS = {
"authHost": "/db/host",
"authUser": "/db/user",
"authPassword": "/db/password",
"authDatabase": "/db/database"
}

# 실행 시 SSM에서 읽어 환경변수로 설정
load_ssm_to_env(PARAMS)

# 환경 변수 로드
authHost = os.getenv("authHost")
authUser = os.getenv("authUser")
authPassword = os.getenv("authPassword")
authDatabase = os.getenv("authDatabase")

app = Flask(__name__)

def connection(): # SQL 연결을 위한 코드
    return mysql.connector.connect(
    host=authHost,
    user=authUser,
    password=authPassword,
    database=authDatabase
    )

def close(cursor, db_connection): # 사용 끝나면 DB 종료
    cursor.close()
    db_connection.close()

@app.route('/setting/favorites', methods=['GET'])
def getFavoritesList():
    # deviceId를 얻기위한 설정
    device_id = request.args.get('device_id')
    
    # db와 연동하기
    db_connection = connection()
    cursor = db_connection.cursor(dictionary=True)
    
    # GET
    query = 'SELECT * FROM favorites WHERE device_id = %s'
    cursor.execute(query, (device_id, ))
    
    # return
    data = cursor.fetchall()
    # close
    close(cursor, db_connection)

    return jsonify(data)

@app.route('/setting/favorites', methods=['POST'])
def createFavorite():
    # 같은 값이 존재하면 막는 코드 필요
    # db와 연동하기
    db_connection = connection()
    cursor = db_connection.cursor()
    
    # 데이터 받아오기
    data = request.get_json() # request : 클라이언트의 요청 내용이 담김 -> json으로 파싱
    device_id = data.get('deviceId')
    name = data.get('name')
    address = data.get('address')
    
    # POST
    insert_query = """
        INSERT INTO favorites(address, name, device_id)
        VALUES (%s, %s, %s)
        ON DUPLICATE KEY UPDATE address = VALUES(address), name = VALUES(name)
        """
    cursor.execute(insert_query,(address, name, device_id))
    db_connection.commit() # 이걸 해야 적용됨.
    
    # return
    cursor = db_connection.cursor(dictionary=True)
    output_query = 'SELECT * FROM favorites'
    cursor.execute(output_query)
    output = cursor.fetchall()
    # close
    close(cursor, db_connection)

    return jsonify(output)

@app.route('/setting/favorites/<int:id>', methods = ['PUT'])
def changeFavorite(id):
    # 데이터 받기
    data = request.get_json()
    device_id = data.get('device_id')
    name = data.get('name')
    address = data.get('address')
    
    # DB 연결하기
    db_connection = connection()
    cursor = db_connection.cursor()

    # PUT
    put_query = 'UPDATE favorites SET address=%s, name=%s WHERE favorite_id=%s AND device_id = %s'
    data = (address, name, str(id), device_id)
    cursor.execute(put_query, data)
    db_connection.commit() 
    
    # return
    cursor = db_connection.cursor(dictionary=True)
    output_query = 'SELECT * FROM favorites'
    cursor.execute(output_query)
    output = cursor.fetchall()
    
    # close
    close(cursor, db_connection)
    return jsonify(output)

@app.route('/setting/favorites/<int:id>', methods=['DELETE'])
def deleteFavorite(id):
    # deviceId 정보 얻기
    device_id = request.headers.get('Device-ID')

    # DB 연결
    db_connection = connection()
    cursor = db_connection.cursor()
    
    # DELETE
    deleteQuery = 'DELETE FROM favorites WHERE favorite_id = %s AND device_id=%s'
    cursor.execute(deleteQuery,(id, device_id))
    db_connection.commit()

    # return
    query = 'SELECT * FROM favorites WHERE favorite_id = %s AND device_id=%s'
    cursor.execute(query, (id, device_id))
    result = cursor.fetchall()
    
    #close
    close(cursor, db_connection)
    return jsonify(result)

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=5010, debug=False, use_reloader=False)
