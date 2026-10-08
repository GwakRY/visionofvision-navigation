# 즐겨찾기 API 후속 개선

이 문서는 2026-10-04 포트폴리오 정리 과정에서 추가한 개선 사항입니다. 프로젝트 당시 구현 내용과 후속 개선을 구분하며, 아래 변경을 당시 성과로 소급해 설명하지 않습니다.

## 변경 내용

| 항목 | 기존 동작 | 후속 개선 |
|---|---|---|
| POST·PUT 응답 | 전체 기기의 즐겨찾기 조회 | 요청 기기의 `device_id`로 목록 조회 제한 |
| 입력 검증 | 누락값 또는 잘못된 JSON이 DB 처리까지 전달될 수 있음 | JSON 객체와 필수 문자열 검증, 잘못된 요청은 400 |
| 수정·삭제 대상 | 대상이 없어도 성공 응답 | 해당 기기의 대상이 없으면 404 |
| 동일 값 수정 | 존재 여부 확인 없음 | 잠금 조회로 존재 여부를 확인해 변경 행 수가 0이어도 성공 처리 |
| DB 오류 | 정상 처리 경로에서만 자원 종료 | 오류 시 rollback, finally에서 Cursor·Connection 정리 |
| 오류 응답 | 기본 오류 응답 | DB 세부정보를 노출하지 않는 JSON 오류 응답 |

## 백엔드 트러블슈팅 1. POST·PUT 응답의 기기별 조회 범위

### 문제

기존 POST·PUT은 즐겨찾기를 등록·수정한 뒤 전체 기기의 즐겨찾기를 응답 목록으로 조회했습니다. 요청 기기와 무관한 다른 기기의 데이터까지 반환될 수 있는 구조였습니다. 이는 기존 코드에서 확인한 문제이며, 실제 운영 장애나 사용자 피해가 관측된 사례로 설명하지 않습니다.

### 원인

POST의 INSERT에는 `device_id`를 저장하고 PUT의 UPDATE에는 `favorite_id + device_id` 조건을 적용했지만, 두 API의 응답용 SELECT에는 기기 조건이 없었습니다. 기존 GET에는 기기 조건이 있었으므로 모든 메서드의 조회가 잘못된 것으로 일반화하지 않습니다.

기존 POST·PUT의 응답 조회 코드:

```python
output_query = 'SELECT * FROM favorites'
cursor.execute(output_query)
output = cursor.fetchall()
```

근거: [개선 전 코드](https://github.com/GwakRY/visionofvision-navigation/blob/27ca9763e4f0ae37cb72c526d51c68159b8477e4/backend/favorites/favorites.py), [후속 개선 커밋](https://github.com/GwakRY/visionofvision-navigation/commit/0772ecb96083bd3145f34de55fb7e3a6996445b2).

### 조치

기기 조건을 적용하는 `list_favorites()`를 만들고 GET·POST·PUT에서 공통으로 사용했습니다. 요청 기기 식별자는 SQL 문자열에 직접 삽입하지 않고 바인딩합니다. 기존 요청 필드와 정상 응답의 배열 형식은 유지했습니다.

```python
def list_favorites(cursor, device_id):
    cursor.execute("SELECT * FROM favorites WHERE device_id = %s", (device_id,))
    return cursor.fetchall()
```

POST·PUT은 쓰기 처리 후 다음 함수를 호출합니다. 목록 재조회까지 성공한 뒤 `database_cursor(write=True)`가 commit을 수행합니다.

```python
output = list_favorites(cursor, device_id)
```

구현: [favorites.py](../backend/favorites/favorites.py)의 `list_favorites()`, `createFavorite()`, `changeFavorite()`.

### 결과 및 검증

POST·PUT의 응답을 요청 기기의 즐겨찾기 배열로 제한했습니다. `test_post_and_put_return_only_request_device`에서는 서로 다른 기기 A·B의 모의 데이터를 사용하고 다음을 확인합니다.

- 기기 A 요청에 A의 데이터만 응답하는지 확인
- `WHERE device_id = %s`와 요청 기기 값의 바인딩 확인
- 정상 응답 200·배열 형식 및 commit·자원 정리 호출 확인

실제 MySQL에 테스트 데이터를 적재한 검증은 아닙니다. 응답 범위 수정은 클라이언트가 전달한 식별자를 기준으로 한 것이므로, 사용자 인증이나 완전한 권한 통제 구현으로 설명하지 않습니다. 응답 크기·조회 시간의 개선 수치는 측정하지 않았습니다.

## 백엔드 트러블슈팅 2. DB 오류 시 rollback 및 자원 정리

### 문제

기존 코드에서는 SQL 실행·목록 재조회·commit 과정에서 예외가 발생하면 뒤에 있는 `close()` 호출에 도달하지 못할 수 있었습니다. 오류가 발생한 쓰기 요청에 대한 명시적 rollback도 없었습니다.

### 원인

DB 처리와 자원 종료를 정상 실행 경로에 순서대로 작성했고, 예외 경로까지 포함하는 `try / except / finally` 구조가 없었습니다.

### 조치

`database_cursor(write=False)` 컨텍스트 매니저로 연결 생성·commit·rollback 시도·종료를 공통화했습니다. 쓰기 처리가 실패하면 rollback을 시도하고, 성공·실패 여부와 관계없이 `finally`에서 자원 정리를 시도합니다.

```python
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
```

`close()`는 Cursor와 Connection 각각의 종료를 시도하여 Cursor 종료 중 MySQL 오류가 발생해도 Connection 종료를 이어갑니다. rollback·종료 중 MySQL 오류는 로그로 남깁니다. 원래 처리 오류는 다시 전달하고, MySQL 오류 처리기는 DB 세부정보를 제외한 JSON과 500을 반환합니다.

### 결과 및 검증

정상 경로에만 있던 DB 자원 정리를 예외 경로에도 적용했습니다. 모의 테스트에서 SQL 실패, POST 목록 재조회 실패, commit 실패, Cursor 생성 실패, 연결 실패를 각각 주입해 응답과 rollback·종료 호출을 확인했습니다. rollback과 Cursor 종료가 함께 실패하는 경우에도 Connection 종료를 시도하는지 확인했습니다.

이는 오류 처리 코드와 호출 흐름의 검증입니다. 실제 DB의 롤백 보장은 테이블 엔진 등 실행 환경에 의존하며, 연결 누수 감소율이나 운영 장애 감소를 측정한 결과는 아닙니다.

## 요청·응답 호환성

기존 요청 필드와 정상 상태 코드 200을 유지합니다.

| 메서드 | 기기 식별자 | 정상 응답 |
|---|---|---|
| GET | Query `device_id` | 해당 기기의 즐겨찾기 객체 배열 |
| POST | JSON `deviceId` | 해당 기기의 즐겨찾기 객체 배열 |
| PUT | JSON `device_id` | 해당 기기의 즐겨찾기 객체 배열 |
| DELETE | Header `Device-ID` | 빈 배열 `[]` |

POST·PUT의 `name`, `address`와 모든 기기 식별자는 공백만 있는 값이 아닌 문자열이어야 합니다. 실패 응답은 `{"error": "..."}` 객체이며, 입력 오류는 400, 대상 없음은 404, MySQL 오류는 500입니다. 입력 문자열은 검증 후 원래 값으로 바인딩합니다.

공개 프론트엔드의 GET 사용 방식은 배열 응답과 호환됩니다. GuideScreen은 SecureStore의 기기 ID로 목록을 조회하고, 도착 목적지와 저장 주소를 비교하여 등록 화면으로 정보를 전달합니다. [확인 가능한 앱 연계 흐름](navigation-implementation.md)에 정리했습니다.

즐겨찾기 등록·수정·삭제 및 저장 항목 선택 화면은 공개되어 있지 않습니다. 해당 화면과의 통합 동작이나 저장 주소 선택 → 목적지 검색의 전체 연결 과정은 확인하지 못했습니다.

POST·PUT은 목록을 조회한 뒤 commit합니다. 처리 중 오류가 발생하면 rollback을 시도합니다. 동일 값의 PUT을 404로 오인하지 않도록 존재 여부를 `SELECT ... FOR UPDATE`로 먼저 확인합니다. 이 잠금과 rollback의 실제 보장은 MySQL 테이블이 InnoDB 같은 트랜잭션 지원 엔진을 사용한다는 전제가 필요합니다.

`ON DUPLICATE KEY UPDATE`는 실제 DB의 PRIMARY KEY 또는 UNIQUE 충돌에 의존합니다. 공개 ERD에는 PK 표시가 있으나 실제 DDL·UNIQUE 제약 정의가 없어 중복 판단 컬럼 조합은 확인하지 못했습니다. 이번 작업에서 스키마나 제약을 변경하지 않았으며, 동일 주소 중복 등록 방지를 검증했다고 설명하지 않습니다.

## 검증

저장소 루트에서 실행합니다.

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

`tests/test_favorites.py`에서 AWS SSM과 DB 연결을 모의 객체로 대체합니다. 실제 AWS 인증정보나 DB 접속 없이 Flask 테스트 클라이언트로 검증합니다.

14개 테스트가 통과했습니다. **2026-10-07 문서 보완 시에도 기존 테스트 14개를 재실행해 모두 통과했습니다.** 검증 범위는 기기 조건과 배열 응답, 입력 검증, SQL Parameter Binding, 동일 값 수정, 대상 없는 수정·삭제, SQL·commit·Cursor 생성·연결 실패, rollback 및 자원 정리 실패 처리입니다.

실제 MySQL의 제약 조건·잠금·트랜잭션 동작, 모바일 화면 연동, EC2 배포는 검증하지 않았습니다. 모듈 초기화 시 SSM을 조회해 연결 설정에 사용하는 기존 방식도 유지했습니다. 요청마다 조회하거나 실행 중 설정 변경을 자동 반영하는 구조는 아닙니다.

## 인증 범위

`device_id`는 데이터 조회·변경 범위를 구분하는 값이며 인증 수단이 아닙니다. 클라이언트가 전달한 식별자를 신뢰하는 기존 구조는 유지되므로, 이 개선을 사용자 인증 또는 완전한 권한 통제로 설명하지 않습니다.
