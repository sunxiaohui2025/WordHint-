# WordHint 云端架构

```text
Chrome 插件（本地缓存） ─┐
                         ├─ HTTPS ─ WordHint API ─ SQLite / PostgreSQL
iOS App（SwiftData 离线库）┘                 ├─ 管理员 Web 控制台
                                            └─ 内网 vLLM
```

## 同步规则

- 每个词以 `user_id + normalized_word` 唯一，用户数据物理隔离。
- 客户端提交 `updatedAt`，服务端采用较新的版本，避免重复导入。
- iOS 继续以 SwiftData 为日常数据源；无网络时学习、发音和复习不受影响。
- Chrome 继续以 `chrome.storage.local` 为数据源；云端不是客户端运行的单点依赖。
- JSON 导入导出和局域网直连保留为灾备通道。

当前版本采用手动“立即双向同步”，避免后台静默覆盖。后续可在相同 API 上增加增量删除墓碑、自动重试和设备冲突历史。

## 安全边界

- 密码使用 scrypt 加盐哈希，登录令牌有签名和有效期。
- LLM 地址和 API Key 只在服务器保存，客户端通过鉴权代理调用。
- 正式部署必须使用 HTTPS，并替换 `WORDHINT_SECRET` 和默认管理员密码。
- 管理员可以审批/停用用户、查看汇总用量、调整模型参数，不能在页面看到用户密码。
