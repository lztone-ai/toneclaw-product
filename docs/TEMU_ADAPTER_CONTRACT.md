# Temu Adapter Contract

> 记录时间：2026-10-03 22:38:55 CST
> 状态：M0 契约草案
> 文档定位：定义 ToneClaw 与 Temu 之间的能力边界、授权模型、状态映射、错误处理和人工降级契约。
> 上游依据：`docs/CORE_MODEL.md`、`docs/STATE_MACHINES.md`、`docs/INTEGRATION_MAP.md`

## 1. Adapter 定位

Temu Adapter 是 ToneClaw 平台适配层中的第一个实现，不是核心业务模型的一部分。

```text
ToneClaw Core
→ Platform Adapter Interface
→ Temu Adapter
→ Temu Partner Platform
```

Adapter 只负责：

```text
外部授权；
店铺信息读取；
平台类目 / 属性读取；
商品适配校验；
Listing 创建或草稿导出；
Listing 状态同步；
订单 / 履约 / 结算数据同步；
平台错误转 ToneClaw 错误。
```

Adapter 不负责：

```text
ToneClaw 内部商品建模；
AI 内容生成；
业务状态机；
成本利润计算；
软件计费；
Token 计量；
UI 展示。
```

## 2. P0 边界

### 2.1 P0 目标能力

| 能力 | P0 范围 |
| --- | --- |
| 授权连接 | 连接一个 Temu 卖家账号 |
| 店铺读取 | 读取店铺基础信息 |
| 店铺能力检查 | 判断哪些能力可用、哪些必须人工降级 |
| 类目读取 / 映射 | 支持目标类目的最小集合 |
| 属性读取 / 映射 | 支持上架必需属性 |
| 商品适配校验 | 输出 `fit / not_fit / needs_info` |
| Listing 创建 | 官方 API 可用时自动创建 |
| Listing 草稿导出 | 官方 API 不足时导出人工上架资料 |
| Listing 状态同步 | 查询平台审核 / 在售 / 驳回状态 |
| Listing 导入 | 支持人工上架后的结果导入与状态回写 |
| 订单同步 | 只读基础订单 |
| 履约同步 | 只读基础履约状态 |
| 结算同步 | 可延后，只保留对象与契约 |
| 错误转换 | 平台错误转 `ErrorCatalogEntry` |

### 2.2 P0 不做

```text
自动改价；
自动改库存；
自动下架；
自动发货；
自动创建备货单；
自动处理售后；
爬虫；
逆向；
未授权 API；
绕过频率限制；
一次性同步全量历史数据。
```

## 3. 授权契约

### 3.1 连接对象

Adapter 操作的对象关系：

```text
BusinessAccount
→ PlatformConnection
→ ExternalSellerAccount
→ Store
→ StoreCapability
```

P0 简化为：

```text
1 BusinessAccount
→ 1 PlatformConnection
→ 1 ExternalSellerAccount
→ 1 Store
```

但 Adapter 接口必须接收：

```text
platformConnectionId
storeId
```

不能假设全局只有一个店铺。

### 3.2 授权输入

进入开发前必须确认 Temu Partner Platform 实际支持的授权方式：

```text
OAuth Authorization Code；
App Key + App Secret；
Seller Token；
Store Token；
其他官方授权方式。
```

Adapter 契约按三种凭据形态预留：

| 类型 | 用途 |
| --- | --- |
| `oauth` | 标准授权码流程，可刷新 |
| `app_key_secret` | 开发者凭据 + 卖家授权关系 |
| `seller_token` | 卖家显式授权 Token |

### 3.3 凭据存储

Adapter 不得在业务数据库中保存明文 Secret。

所有敏感信息必须通过 `secret_ref` 访问安全存储。

`PlatformCredential` 保存：

```text
credential_type
secret_ref
scopes
status
expires_at
last_verified_at
```

### 3.4 授权状态映射

| Temu / Adapter 结果 | PlatformConnection.status | PlatformCredential.status | Store.status |
| --- | --- | --- | --- |
| 发起授权 | `pending` | `pending` | `connecting` |
| 授权成功 | `active` | `active` | `connected` |
| 授权失败 | `invalid` | `invalid` | `error` |
| Token 过期 | `expired` | `expired` | `expired` |
| 卖家撤销 | `revoked` | `revoked` | `disconnected` |
| 平台异常 | `error` | `invalid` 或 `expired` | `error` |
| 用户断开 | `disconnected` | `revoked` 或 `expired` | `disconnected` |

P0 不实现自动刷新。
`expired` 后进入重新授权流程。

## 4. StoreCapability 检查

Adapter 必须在连接成功后检查以下能力，并写入 `StoreCapability`。

| capability_key | 说明 | 降级方式 |
| --- | --- | --- |
| `store.read` | 读取店铺信息 | 人工录入店铺信息 |
| `category.read` | 读取平台类目 | 使用人工维护的 Temu 类目映射 |
| `attribute.read` | 读取类目属性 | 使用人工维护的必需属性映射 |
| `listing.create` | 创建 / 提交 Listing | 导出草稿资料，人工上架 |
| `listing.status.read` | 查询 Listing 状态 | 人工导入平台状态 |
| `order.read` | 查询订单 | 暂时不可用时提示数据不可见 |
| `fulfillment.read` | 查询履约 | 暂时不可用时提示数据不可见 |
| `settlement.read` | 查询结算 | 可延后 |

每个能力保存：

```text
status = available / unavailable / unknown
mode = api / manual / export_import / unsupported
checked_at
notes
```

Adapter 必须根据能力决定运行路径，不能假设所有 API 都可用。

## 5. 类目与属性契约

### 5.1 核心原则

ToneClaw 核心类目和核心属性保持平台无关。

```text
Category
→ PlatformCategoryMapping
→ Temu Category

AttributeDefinition / AttributeValue
→ PlatformAttributeMapping
→ Temu Attribute
```

Adapter 不允许把 Temu 类目或 Temu 属性直接写入 `Product`。

### 5.2 P0 最小能力

P0 不做完整类目树。

P0 只需要：

```text
目标卖家经营类目的最小集合；
每个类目的必需属性；
每个类目的图片规格；
禁售和资质提示；
平台类目 ID 和路径。
```

### 5.3 适配校验输出

`PlatformFitAssessment` 至少检查：

| 检查项 | 结果 |
| --- | --- |
| 类目映射是否存在 | `passed / warning / failed` |
| 必需属性是否完整 | `passed / warning / failed` |
| 图片规格是否满足 | `passed / warning / failed` |
| 价格是否明显异常 | `passed / warning / failed` |
| 禁售或资质风险 | `passed / warning / failed` |

最终输出：

```text
fit
not_fit
needs_info
```

## 6. Listing 创建与人工降级

### 6.1 自动创建路径

如果 `listing.create = available`：

```text
ListingDraft.approved
→ PublishJob.queued
→ PublishJob.running
→ Temu Adapter submitListing
→ PublishJob.succeeded
→ Listing.submitted
```

提交成功后，Adapter 必须保存：

```text
external_listing_id
platform_raw_status
submitted_at
external_job_ref
```

### 6.2 人工降级路径

如果 `listing.create` 不可用：

```text
ListingDraft.approved
→ PublishJob.needs_manual_action
→ 生成导出包
→ 卖家人工在 Temu 后台上架
→ 卖家回填平台 Listing 链接 / ID
→ Adapter 或导入器查询平台状态
→ Listing.core_status 回写
```

导出包至少包含：

```text
Temu 标题；
Temu 描述；
Temu 类目；
Temu 属性；
Temu 图片；
SKU / Offer 信息；
价格；
库存；
合规提示。
```

### 6.3 人工导入状态

`Listing` 支持以下入口：

```text
listing.import.live
listing.import.review
listing.import.rejected
listing.import.inactive
```

导入时必须保存：

```text
origin = imported / manual_recovery
external_listing_id
platform_raw_status
import_source_ref
AuditLog
```

禁止在没有平台证据时直接标记为 `live`。

## 7. Listing 状态映射

Adapter 必须把 Temu 原始状态映射为 ToneClaw 状态。

| Temu Raw Status | ToneClaw Platform Status | Listing.core_status |
| --- | --- | --- |
| 已提交 | `submitted` | `submitted` |
| 平台审核中 | `platform_review` | `platform_review` |
| 审核通过 / 在售 | `live` | `live` |
| 审核驳回 | `rejected` | `rejected` |
| 已下架 / 停售 | `inactive` | `inactive` |
| 已归档 / 已删除 | `archived` | `archived` |
| 未知 | `unknown` | 保持上一状态并生成 Finding |

Adapter 不允许直接把 Temu 原始状态字符串写入业务逻辑。

## 8. 订单与履约契约

### 8.1 订单同步

P0 只做只读同步。

```text
Temu Order
→ Temu Adapter
→ ToneClaw Order / OrderItem
```

最小同步字段：

```text
external_order_id；
order_number；
order_status；
currency；
金额；
下单时间；
明细；
SKU；
数量；
单价。
```

### 8.2 状态映射

| Temu Order Raw Status | ToneClaw Order.status |
| --- | --- |
| 待付款 | `created` |
| 已付款 / 待备货 | `paid` |
| 待履约 | `waiting_fulfillment` |
| 部分发货 | `partially_shipped` |
| 已发货 | `shipped` |
| 已签收 | `delivered` |
| 已取消 | `canceled` |
| 已完成 / 已关闭 | `closed` |

### 8.3 履约状态映射

| Temu Fulfillment Raw Status | ToneClaw Fulfillment.status |
| --- | --- |
| 待备货 | `stocking` |
| 待发货 | `ready_to_ship` |
| 已发货 | `shipped` |
| 运输中 | `in_transit` |
| 已签收 | `delivered` |
| 异常 | `exception` |
| 已取消 | `canceled` |

P0 不做自动发货和自动改库存。

## 9. 结算契约

结算能力可延后，但对象和契约预留。

```text
Temu Settlement
→ Adapter
→ ToneClaw Settlement
```

最小字段：

```text
external_settlement_id；
period_start；
period_end；
gross；
platform_fee；
commission；
shipping_fee；
refund；
adjustment；
net；
currency；
status；
payout_time。
```

如果 `settlement.read` 不可用，P0 显示为：

```text
暂无平台数据
```

## 10. 同步任务契约

所有平台调用都应通过 `SyncJob` 追踪。

| job_type | object_type | P0 频率 |
| --- | --- | --- |
| `pull` | `store` | 连接后一次；之后可低频 |
| `pull` | `platform_category` | 手动触发或低频 |
| `pull` | `platform_attribute` | 手动触发或低频 |
| `push` | `listing` | 人工确认后触发 |
| `pull` | `listing` | 上架后按需或低频 |
| `pull` | `order` | 5–15 分钟一次 |
| `pull` | `fulfillment` | 5–15 分钟一次 |
| `pull` | `settlement` | 可延后 |

`SyncJob` 保存：

```text
attempt_count
max_attempt_count
next_run_at
status
error_catalog_id
started_at
finished_at
```

## 11. 错误契约

### 11.1 错误分类

| category | 说明 | retryable |
| --- | --- | --- |
| `auth` | 授权失败 / Token 过期 | 否 |
| `permission` | Scope 不足 | 否 |
| `validation` | 参数或业务数据不合法 | 否 |
| `rate_limit` | 超过频率限制 | 是 |
| `server` | 平台 5xx / 系统异常 | 是 |
| `not_found` | 资源不存在 | 否 |
| `conflict` | 资源冲突 | 视情况 |
| `unknown` | 未识别错误 | 否 |

### 11.2 错误处理

Adapter 必须把平台错误转换为：

```text
ErrorCatalogEntry
```

并输出：

```text
platform
raw_code
raw_message_ref
category
user_message
retryable
remediation
```

不得把平台原始错误码直接透传给核心业务状态。

### 11.3 重试策略

P0 最小策略：

```text
auth / permission / validation：不重试；
rate_limit：最多 3 次，指数退避；
server：最多 3 次，指数退避；
not_found / unknown：不自动重试；
重试失败后进入 needs_manual_action。
```

## 12. Adapter 接口契约

以下接口是逻辑契约，不是最终代码签名。

### 12.1 授权

```text
createAuthorization(businessAccountId)
handleAuthorizationCallback(payload)
verifyConnection(platformConnectionId)
disconnect(platformConnectionId)
```

### 12.2 店铺与能力

```text
fetchStore(platformConnectionId, storeId)
fetchStoreCapabilities(platformConnectionId, storeId)
```

### 12.3 类目与属性

```text
fetchCategories(storeId)
fetchAttributes(storeId, platformCategoryId)
```

### 12.4 Listing

```text
validateProductFit(storeId, product)
createListing(storeId, listingDraft)
fetchListingStatus(storeId, externalListingId)
importListingResult(storeId, importedListingPayload)
```

### 12.5 订单与履约

```text
fetchOrders(storeId, timeRange)
fetchFulfillments(storeId, externalOrderId)
```

### 12.6 结算

```text
fetchSettlements(storeId, timeRange)
```

## 13. 数据安全

Adapter 必须遵守：

```text
只使用 Temu Partner Platform 官方授权；
不保存明文 Secret；
平台凭据按 BusinessAccount + PlatformConnection 隔离；
每个请求携带正确 Store / Authorization 上下文；
平台数据只用于授权卖家的经营用途；
平台错误与敏感信息不得完整展示给普通用户；
所有连接、发布、导入和断开动作写 AuditLog。
```

## 14. M0 冻结前待确认项

| 事项 | 影响 |
| --- | --- |
| Temu Partner Platform 账号是否已开通 | 决定能否真实验证 Adapter |
| App Key / Secret 是否已取得 | 决定授权联调 |
| 授权方式是 OAuth 还是 App Key + Seller Token | 决定 PlatformConnection 实现 |
| `listing.create` 是否可用 | 决定自动上架还是人工降级 |
| 类目 / 属性 API 是否可用 | 决定映射维护方式 |
| 订单 / 履约 API scope 是否可用 | 决定 P0 经营数据可见性 |
| 平台频率限制 | 决定同步策略 |
| 平台错误码清单 | 决定 ErrorCatalog 初始版本 |

在这些项确认前，Temu Adapter 只能完成接口层和人工降级路径的框架实现，不能宣称完成真实闭环。

## 15. 真实模型核实记录（2026-10-09，公开资料检索）

> 依据：Temu 卖家大学（kuajingmaihuo.com）`goods.create` 对接文档、第三方铺货开放接口文档与 Go SDK 类型定义。最终以官方开放平台文档与真实联调为准。

| 维度 | 已核实的真实模型 | 对 mock 塑形的影响 |
| --- | --- | --- |
| 属性标识 | 数字模板体系 `pid` / `templatePid` / `vid`，值选项来自 `attrs.get` | mock valueSchema 携带 pid / templatePid / vidOptions；attributeKey 保留为 core 侧稳定映射键（TAC §5.1） |
| 属性值 | `vid` + `propValue` + `valueUnit` + `numberInputValue` | mock `createListing` 内部按模板解析为该形状 |
| 类目 | `cat1Id`~`cat10Id` 最多 10 级，缺级传 0 | mock 最小树 3 级，cat4~10Id 传 0 |
| 必填属性 | 每个叶子类目规定必填属性集 | mock attributeSchemas 按叶子类目组织 |
| 属性层级依赖 | 供电方式 = USB充电 / 电池式 → 需填电池容量；材质 = 原木 → 需填木种 | mock `dependsOn` 模拟两条链，required 仅在依赖满足时生效 |
| 半托管发品 | `productWarehouseRouteReq` 必传 | mock goods create 形状含仓库路由 |
| 发品请求 | `goods.create`：productName / carouselImageUrls / productPropertyReqs / ... | mock `lastGoodsCreateRequest()` 提供形状探针 |

仍未核实 / 待真实联调（补充 §14）：

- `attrs.get` 精确响应结构与真实 pid / vid 值；
- SKU / SKC 规格结构（`productSpecPropertyReqs` / `productSkcReqs`）未在 mock 建模；
- 真实类目树数据、官方错误码清单与频率限制；
- 平台原始状态词与 §7 映射表的逐词对照。
