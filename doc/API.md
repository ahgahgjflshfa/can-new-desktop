# 立碼幫幫忙 API（v1.0）

## 基本資訊

- Base URL: `https://www-u.tymetro.com.tw/station_services/api`
- Content-Type: `application/json; charset=utf-8`
- 格式: Request/Response 皆為 JSON

## 驗證

- 除 `POST /auth/login` 外，所有 API 皆需 Bearer Token
- Header: `Authorization: Bearer <access_token>`

## 標準回應

```json
{
  "status": "success",
  "message": "操作成功",
  "data": {}
}
```

- `status`: `success` | `error`
- `message`: 可顯示給使用者的訊息
- `data`: 物件或陣列（可省略）

## 時間格式

- DB 原始格式: `yyyy-MM-dd HH:mm:ss`（字串）
- App 使用格式: Unix Timestamp（毫秒，Long）
- `0` 或 `null`: 代表該時間點尚未發生

## Auth API

### POST `/auth/login`

用途: 登入並取得 Token（支援多裝置同時登入）

Request Body:

| 參數        | 型別   | 必填 | 說明                        |
| ----------- | ------ | ---- | --------------------------- |
| account     | string | 是   | 員工帳號                    |
| password    | string | 是   | 密碼                        |
| device_type | string | 是   | 固定 `windows` 或 `android` |
| device_id   | string | 是   | 裝置唯一識別碼              |
| fcm_token   | string | 否   | Android FCM Token           |

Response（success）:

```json
{
  "status": "success",
  "message": "Login successful",
  "data": {
    "token": "a1b2c3d4...",
    "user": {
      "name": "王小明",
      "station_id": "A1",
      "section_id": null,
      "role": "staff"
    }
  }
}
```

### POST `/auth/logout`

用途: 使目前 Token 失效

Header:

- `Authorization: Bearer <token>`

Response:

```json
{
  "status": "success",
  "message": "Logged out"
}
```

## Tasks API（皆需 Bearer Token）

### GET `/tasks`

用途: 取得近 20 筆待處理與處理中任務

Response（節錄）:

```json
{
  "status": "success",
  "data": [
    {
      "id": 105,
      "station_id": "A17",
      "station_name": "領航站",
      "location_name": "出入口",
      "location_code": "A17-ASSIST-1",
      "status": "pending",
      "created_at": 1770011612000,
      "replied_at": 0,
      "done_at": 0
    }
  ]
}
```

### POST `/tasks/{id}/reply`

用途: 回覆任務（接單）

Request Body:

- 空物件 `{}` 或不傳

Response:

```json
{
  "status": "success",
  "message": "Task replied",
  "data": [
    {
      "id": 49,
      "status": "replied"
    }
  ]
}
```

### POST `/tasks/{id}/complete`

用途: 完成任務（結案）

Request Body:

| 參數   | 型別   | 必填 | 說明                       |
| ------ | ------ | ---- | -------------------------- |
| result | string | 是   | `normal` 或 `no_passenger` |

Response:

```json
{
  "status": "success",
  "message": "Task completed",
  "data": [
    {
      "id": 48,
      "status": "completed"
    }
  ]
}
```

## Enums

### 任務狀態 `status`

- `pending`: 待處理（無人接單）
- `replied`: 處理中（已回覆/前往中）
- `completed`: 已完成
- `ignored`: 已忽略（系統自動攔截）

### 結案結果 `completion_result` / `result`

- `normal`: 正常服務完成
- `no_passenger`: 現場無人 / 誤報
