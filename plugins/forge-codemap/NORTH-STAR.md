# codemap — north star

> Hệ thống comment **có nguyên tắc** cho những sự thật không công cụ nào suy ra được — cộng một
> checker đọc chúng, và một hook đưa chúng tới agent **trước khi** agent sửa file.

**Bản này để chống trôi mục tiêu.** Đọc §2 và §7 trước khi thêm bất cứ tính năng nào. Một đề xuất
không trỏ được về một cơn đau ở §2 là một đề xuất bị từ chối.

Cập nhật 2026-08-19. Anh em: `SPEC.md` (cơ chế) · `README.md` (cách dùng) ·
`~/tools/repo-gates/NORTH-STAR.md` (chỉ mục 4 sản phẩm).

---

## 1. Câu hỏi nó trả lời

Cùng câu hỏi với archmap, apiflow, KineTrak — khác chất liệu:

> **“Đổi cái này thì còn cái gì bị ảnh hưởng?”** — trả lời **trước khi sửa**, không phải sau khi hỏng.

Chất liệu của codemap: **ràng buộc chỉ nằm trong đầu người.**

## 2. Ai đau, đau vì cái gì

**Ai:** người phải review code do agent viết, và cứ gặp lại cùng một loại lỗi.

**Cơn đau KHÔNG phải** “thiếu tài liệu”, cũng không phải “code khó đọc”.

**Cơn đau là:** agent sửa một file và làm vỡ một điều kiện **chưa ai từng viết ra** — kiểu
*“hai file này phải sửa cùng nhau”*, *“phá điều kiện này thì hỏng state”*, *“lệnh này thay thế chứ
không merge”*, *“thứ tự gọi bắt buộc”*. Những thứ đó không nằm trong type, không nằm trong test,
không nằm trong tên hàm. Trước codemap chúng nằm trong đầu một người — và agent không có ký ức
giữa các phiên.

**Cơn đau thứ hai, ít ai gọi tên:** agent viết comment thừa. Dùng lint để **cấm** thì chỉ tạo ra
khoảng trống — năng lượng biến mất mà thông tin thật vẫn không xuất hiện.

## 3. Cái làm nó khác thứ đã có

| Thứ đã có | Vì sao không thay được |
|---|---|
| type system / compiler | nói được *hình dạng dữ liệu*, không nói được *hai file phải sửa cùng nhau* |
| linter (eslint, biome…) | làm việc trong AST **một file**, không có cạnh liên file |
| LSP / go-to-definition | thấy tham chiếu có thật, mù với coupling **không phải tham chiếu** (chuỗi, tên, SQL, cron) |
| doc / ADR / wiki | không ai đọc đúng lúc sắp sửa file đó |
| lint cấm comment | tạo khoảng trống, không tạo thông tin |

**Vị trí đúng của codemap trong một câu:** nó không phải một linter khắt khe hơn — nó **chuyển
hướng** xu hướng viết comment của agent thành một **lớp dữ liệu** đọc được, kiểm được, truy vấn
được, và inject lại cho agent tiếp theo. Biến chi phí comment thành tài sản.

Năm chỗ được phép viết: `cm:guard` · `cm:edge` · `cm:flow` · `cm:hack` · `cm:why`. Ngoài năm chỗ đó
là comment thường, và comment thường thì không được diễn đạt lại thứ tool đã suy ra được.

## 4. Bằng chứng hôm nay (đo 19/08/2026)

Trên repo forge (`cm verify --tier referential`, exit 0):
```
2350 file quét
 494 cm:guard
 408 cm:why
 181 cm:edge   (21 đã neo)
   2 cm:flow
   1 cm:hack
13410 legacy prose đang bị đóng băng · 3 đã dọn (0%)
```

**Tỉ lệ 13.410 / 1.086 là thước đo tiến độ của việc chuyển hướng** — nó đo *chất* của comment, không
đo lượng, và đo được ngay hôm nay không cần người ngoài.

Độ chín: **290 test xanh** · 18 verb · 8 language profile (ts/go/php/py/rust/sql/sh/yaml) ·
`tests/cli.mjs` 687 dòng test end-to-end · 1 stub tự khai (`cm migrate`, exit 2) ·
đang cài ở **5 repo** (anhome, forge, epodsystem-core, sidboss, server-vault) ·
có **cả `PreToolUse` và `PostToolUse`** — là công cụ duy nhất trong bốn cái đạt bậc 1.

CM301/CM302 (advisory) đang **mặc định tắt**, tự khai FP rate chưa đo.

## 5. North star

> **Số repo KHÔNG phải của chủ sở hữu, trong đó có người tự tay viết một `cm:` annotation.**

Không gian lận được: viết thêm code không làm người lạ chấp nhận một từ vựng mới. Đây là phép thử
duy nhất cho câu hỏi thật — *primitive này đúng, hay chỉ đúng với người nghĩ ra nó.*

| Mốc | Chỉ tiêu |
|---|---|
| 30 ngày | chưa tính — giai đoạn này chỉ đo chỉ số dẫn |
| 90 ngày | **1 repo** ngoài, ≥1 annotation người khác viết |
| 12 tháng | **10 repo** ngoài, mỗi repo ≥5 annotation người khác viết |

**Chỉ số dẫn (tự làm được):**
1. Repo nội bộ có codemap: **5 → 15**.
2. Bot nâng cấp hàng tuần chạy thật, có log, **4 tuần liên tiếp** (nó đã chết âm thầm một thời gian
   không rõ — xem nhật ký).
3. Tỉ lệ legacy prose giảm; `cm:` annotation tăng.
4. CM301 lên `warn` sau khi đọc được đồ thị archmap.

## 6. Kill criteria

12 tháng mà **0 annotation do người ngoài viết** → đây là quy ước nội bộ của một người, không phải
sản phẩm. Giữ dùng nội bộ, rút khỏi danh sách public, ngừng đầu tư phân phối. **Không bảo vệ nó
bằng cách viết thêm tài liệu.**

## 7. Không làm

- **Không thành một linter tổng quát.** Luật diễn đạt được bằng rule linter thì thuộc về linter
  (bậc 2–3), không thuộc `cm:`. Xem thang bậc trong `~/tools/repo-gates/PLAYBOOK.md` §B2.
- **Không phá ràng buộc zero-dependency.** `scripts/lib/registry.mjs:3-4` viết rõ lý do: *“a plugin
  that needs `npm install` before its hooks work is a plugin that gets disabled.”* Đây là điều kiện
  tồn tại, không phải sở thích.
- **Không gộp với eslint-plugin-code-quality.** Nó cần peerDep `eslint` — gộp là phá điều trên.
  Hai thứ đứng cạnh nhau, không nhập.
- **Không dựng một tầng hợp nhất trên codemap + archmap.** Đó là gatemap: chết hai lần
  (v1 13/08/2026 bị bốn review độc lập bác; v2 19/08/2026 bị PLAYBOOK §D khai tử sau 2 tiếng).
- **Không bật advisory tier khi chưa đo FP rate.** Tiêu chí mượn của Google/Tricorder: vào ở `warn`,
  lên `error` khi FP dưới ngưỡng **và** đã về 0 finding.
- **Không viết thêm README.** 311 dòng là đã quá đủ cho lượng người dùng hiện tại.

## 8. Lộ trình của repo này

**Phase 0 — chặn máu**
- Xác nhận bot nâng cấp hàng tuần chạy thật một lần, có log.

**Phase 1 — phân phối** *(codemap đi trước trong bốn sản phẩm)*
- Rollout 5 → 15 repo nội bộ qua `forge_config` → `plugin_sync.rs:89`.
- Public. Mở khoá cho archmap khi có **1 issue/PR từ người lạ**.

**Phase 2 — mối nối đáng làm**
- `graph.mjs:108` tự thú: *“Evidence is a basename match, not an import graph”* — CM301 đang đoán
  coupling có thật hay không **bằng cách so tên file**. archmap đã có đúng đồ thị đó.
- Việc: archmap export edges → CM301 đọc nó → đo FP → lên `warn` → lên `error`.
- **Đây là tính năng, không phải refactor.** Dọn lớp chung (`globToRe` ×2, `findRoot` ×2,
  install/vendor ~270 dòng ×2) làm sau, và chỉ là dọn dẹp.

## 9. Nhật ký quyết định

- **2026-08-19** — Chốt định vị: *chuyển hướng* comment thay vì *cấm* comment. Đây là điểm dễ bị
  hiểu nhầm nhất; mọi mô tả sản phẩm phải nói vế này trước vế checker.
- **2026-08-19** — Chốt public. Thứ tự: codemap đi đầu vì hoàn thiện nhất và kênh phân phối đã chạy
  thật.
- **2026-08-19** — gatemap v2 bị khai tử; khoảng trống giữa codemap và archmap là **cố ý**.
- **~2026-08** — Phát hiện bot nâng cấp hàng tuần đã chết âm thầm (`node20` bị ép off). Đã sửa,
  **chưa xác nhận chạy lại**.
