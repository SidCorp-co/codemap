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
đang cài ở **15 repo nội bộ** (đo lại 02/09/2026 — xem §10) ·
có **cả `PreToolUse` và `PostToolUse`** — là công cụ duy nhất trong bốn cái đạt bậc 1.

CM301/CM302 (advisory) vẫn **mặc định tắt** — `enforce.advisory` trong registry, hoặc
`--tier advisory` tường minh, vẫn là cổng duy nhất; archmap có mặt không tự bật tier (`archmap
graph` tốn ~15s trên repo 1600+ file, và hook chạy `cm verify` tier=all trên MỖI lần sửa file —
tự bật theo archmap từng gây stall nhiều giây mỗi lần sửa, đã đo và sửa lại). Khi tier được bật
(bằng tay), nó đọc `archmap graph --json` làm bằng chứng thật thay vì so tên file. Đo lại trên
archmap thật (repo `forge`, 1905 file): 6 hit CM301 cũ, **0** bị đồ thị thật loại thêm — khớp với
phân tích tay đã có ở SPEC §7.1 (cả 6 đều là coupling không có tham chiếu thật). Chưa lên `error`
— đúng theo lộ trình §8.

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
1. Repo nội bộ có codemap: **5 → 15 — xong 02/09/2026** (ISS-4), nhưng đúng con số là **6 vendored
   (baseline riêng) / 9 plugins-advisory (chưa baseline)** — `sidboss` đã ở tier plugins TRƯỚC
   ISS-4, không phải vendored, nên "7 pre-existing" ở §10 là cách đếm cũ, đã sửa. Đếm là quy mô,
   không phải tác dụng — §5 vẫn đo tác dụng riêng bằng annotation người ngoài viết. "Mỗi repo có
   baseline riêng" (kết quả cần đạt của ISS-4) mới đúng cho 6/15 — xem §10 và các issue theo dõi ở
   đó cho 9 repo còn lại.
2. Bot nâng cấp hàng tuần chạy thật, có log, **4 tuần liên tiếp** (nó đã chết âm thầm một thời gian
   không rõ — xem nhật ký).
3. Tỉ lệ legacy prose giảm; `cm:` annotation tăng — đo được: `cm metrics show` (SPEC.md §10, ISS-3).
4. CM301 đọc được đồ thị archmap thật khi tier được bật — **xong** (§8 Phase 2); bật `warn` theo
   mặc định vẫn chờ một lớp cache cho `archmap graph` (~15s/lần), vì hook gọi `cm verify` mỗi lần
   sửa file.
5. Hook chặn bao nhiêu lần, vì check nào, và lần chặn đó có giữ được hay bị lách qua — đo cục bộ,
   gửi là opt-in: `cm metrics show` / `cm metrics send` (SPEC.md §10). Trước ISS-3 không có cách
   nào đếm con số này; mọi bằng chứng ở §4 là quy mô, không phải tác dụng.

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
- Xác nhận bot nâng cấp hàng tuần chạy thật một lần, có log — **xong 2026-09-03 (ISS-5)**, nhưng
  không phải theo cách đề bài đoán: bot không chết, **nguồn tag nó đọc đã ngừng chảy**. Chi tiết ở
  §9. Còn lại của đề bài — "4 tuần liên tiếp" (§5 chỉ số dẫn #2) — chưa đo được từ phiên này, vì
  điều đó đòi quan sát 4 lần chạy thật trong các repo consumer, ngoài quyền ghi của issue này.

**Phase 1 — phân phối** *(codemap đi trước trong bốn sản phẩm)*
- **Tách repo riêng.** Hôm nay codemap là `plugins/forge-codemap/` trong
  `SidCorp-co/forge-pipeline-skills` — public, nhưng chỉ chiếm 34/190 file tracked; phần còn lại là
  86 file bundle, 32 skill, 26 profile không liên quan. Hai hệ quả chặn Phase 1:
  1. GitHub **chỉ đọc `.github/ISSUE_TEMPLATE/` ở gốc repo**. Bốn form đã viết sẵn ở
     `plugins/forge-codemap/.github/ISSUE_TEMPLATE/` — đúng đường dẫn sau khi tách, **nằm im
     trước khi tách**.
  2. Điều kiện mở khoá dưới đây là *“1 issue từ người lạ”*. Trong hộp thư dùng chung với 32 skill
     khác thì tín hiệu đó **không quy về codemap được** — nó không đo được, nên không dùng làm
     cổng được.
- Rollout 5 → 15 repo nội bộ qua `forge_config` → `plugin_sync.rs:89` — **xong 02/09/2026** (ISS-4,
  chi tiết §10). Tầng `plugins` mới chỉ mở visibility (advisory, không chặn); tầng vendored/gated —
  `cm init` đóng băng baseline rồi commit `.forge/codemap/` — còn lại làm trong issue riêng của
  từng repo, không làm từ ISS-4.
- Public. Mở khoá cho archmap khi có **1 issue/PR từ người lạ**.

**Phase 2 — mối nối đáng làm** *(xong phần đọc đồ thị + đo FP; `warn` mặc định vẫn chờ cache)*
- `graph.mjs` từng tự thú: *"Evidence is a basename match, not an import graph"* — CM301 đoán
  coupling có thật hay không **bằng cách so tên file**. Đã sửa: `scripts/lib/archmap.mjs` đọc
  `archmap graph --json` khi tier advisory được bật; đồ thị thật được hỏi TRƯỚC basename, và
  không cần archmap để check vẫn chạy như cũ.
- Đo trên archmap thật thay vì đoán: 0/6 hit đo lại trên repo `forge` được đồ thị thật loại thêm —
  cả 6 đã đúng là coupling không tham chiếu (SPEC §7.1).
- **Chưa tự bật theo mặc định.** Thử tự bật khi archmap có mặt (bỏ qua `enforce.advisory`) đã bị
  đo thấy gây stall ~15s trên MỖI lần sửa file, vì hook gọi `cm verify` tier=all không có
  `--tier` — và `archmap graph` là một lần quét cả repo. Đã revert về đúng cổng cũ
  (`enforce.advisory` hoặc `--tier advisory` tường minh); còn lại việc tự bật cần một lớp cache
  cho archmap trước, để sau. Chưa lên `error`.
- Còn lại, ưu tiên thấp hơn: dọn lớp chung (`globToRe` ×2, `findRoot` ×2, install/vendor ~270
  dòng ×2) giữa codemap và archmap — thuần dọn dẹp, không chặn việc trên.

## 9. Nhật ký quyết định

- **2026-08-19** — Chốt định vị: *chuyển hướng* comment thay vì *cấm* comment. Đây là điểm dễ bị
  hiểu nhầm nhất; mọi mô tả sản phẩm phải nói vế này trước vế checker.
- **2026-08-19** — Chốt public. Thứ tự: codemap đi đầu vì hoàn thiện nhất và kênh phân phối đã chạy
  thật.
- **2026-08-19** — gatemap v2 bị khai tử; khoảng trống giữa codemap và archmap là **cố ý**.
- **~2026-08** — Phát hiện bot nâng cấp hàng tuần đã chết âm thầm (`node20` bị ép off). Đã sửa,
  **chưa xác nhận chạy lại**.
- **2026-09-03 (ISS-5)** — Xác nhận, và nguyên nhân khác giả thuyết ban đầu. Repo `forge` (vendored,
  đo trực tiếp trên checkout của project đó) đứng ở `0.13.0` dù `plugin.json` ở đây đã ghi `0.14.0`
  rồi `0.15.0` — hai bump đó (253d315, ba42a5f) **không có tag `codemap-v*` đi kèm**, khác với mọi
  bump trước (mỗi bump luôn có tag trỏ đúng commit đó). Bot đọc "mới nhất" bằng
  `git tag -l codemap-v* | sort -V | tail -1` — không có tag thì bot không có gì để lấy, và im lặng
  đó giống hệt "đã mới nhất". Đã sửa ba việc: (1) cắt `codemap-v0.14.0`/`codemap-v0.15.0` trên đúng
  hai commit bump, đẩy lên origin; (2) chạy lại đúng chuỗi lệnh của
  `agent-setup/codemap-upgrade.yml` (clone công khai → fetch tags → resolve mới nhất → checkout →
  `cm install --upgrade`) trên một repo giả lập vendored ở `0.13.0` — kết quả thật:
  `codemap 0.13.0 -> 0.15.0 in .forge/codemap/ 19 files`, đây là "một lần chạy quan sát được" đề bài
  đòi; (3) thêm `tests/release-tag.mjs` — `node tests/run.mjs` giờ đỏ nếu `plugin.json` bump version
  mà tag tương ứng chưa tồn tại, để lỗ hổng này không tái diễn âm thầm lần nữa.
  **Vòng review độc lập bắt thêm một lỗi thật thứ hai, nặng hơn cái đầu:** bước install của chính
  `agent-setup/codemap-upgrade.yml` viết `cd /tmp/codemap && git checkout ...` rồi lệnh `cm.mjs
  install --upgrade` ngay dòng sau, **cùng một `run:` block** — `cd` đó rò sang dòng sau, nên
  `cm install` (không có cờ `--root`, luôn vendor vào `$(pwd)`) tự vendor vào bản clone tạm, không
  phải vào repo consumer đã checkout. PR ra rỗng, im lặng, MỌI lần chạy — bất kể tag có mới hay
  không. Repo `forge` đã tự phát hiện và tự vá đúng lỗi này trong bản họ copy ra (đổi sang `git -C`,
  còn ghi lại trong comment của file đó) nhưng bản vá **chưa bao giờ được đưa ngược lại template ở
  đây** — nghĩa là mọi repo mới copy template từ đây (9 repo tier `plugins` ở §10) sẽ dính lại đúng
  lỗi mà `forge` đã từng vá. Đã sửa: đổi cả hai bước sang `git -C /tmp/codemap` (khớp bản vá của
  `forge`), và thêm `tests/upgrade-workflow.mjs` — chạy **đúng script `run:` block đó**, cắt trực
  tiếp từ file yml, chống lại một repo giả lập, để xác nhận nó vendor vào đúng chỗ; test này đã tự
  đỏ khi tôi tạm phục hồi bản `cd` để kiểm chứng nó bắt được lỗi thật, rồi xanh lại sau khi vá.
  **Còn treo, ngoài quyền của issue này:** repo `forge` tự nó cần chạy lại workflow thật của nó (hoặc
  đợi cron thứ Hai tới) để vendored copy thực sự lên `0.15.0` — issue này chỉ sửa được nguồn tag và
  template, không có quyền ghi vào repo `forge`.
- **2026-09-02** (ISS-4) — Đo lại trước khi cài: con số "5" ở §4 đã cũ, thực tế là 6 vendored +
  1 plugins-advisory (`sidboss`, đã cài ngoài issue này) = 7 repo có codemap ở dạng nào đó, không
  phải 7 vendored như bản nháp đầu của log này từng viết nhầm. Rollout 8 repo mới trong ISS-4 chỉ
  tới tầng `forge_config.plugins` (advisory) — tầng vendored/gated (đòi `cm init` đóng băng
  baseline trong chính repo đó) không làm từ phiên này, vì phiên ISS-4 không có worktree ở các
  repo đó và đẩy code vào nhánh chính của project khác từ một issue thuộc `codemap` là vượt biên
  ownership. Thay vào đó: mở 1 issue theo dõi trong TỪNG project ở tier plugins (9 issue, cho cả
  `sidboss` và 8 repo mới) để `cm init`/`cm install`/wire gate chạy đúng trong project sở hữu, có
  review của project đó — xem §10 để lấy issue id.

## 10. Rollout log (ISS-4, đo 2026-09-02)

Tier `vendored` = `.forge/codemap/` cam kết trong repo + gate chặn trong CI (prose cũ đã đóng băng
baseline). Tier `plugins` = chỉ gắn qua `forge_config.plugins` — hook `PreToolUse`/`PostToolUse`
chạy cho ai có agent session, nhưng chưa `cm init` nên **không có baseline** → nhánh chặn-vì-prose ở
`PostToolUse` tự tắt (xem README "How it works"); chỉ còn advisory (`cm impact`, chặn lỗi cú pháp
annotation). Đây đúng nghĩa "đo trước, cài sau": không đo thì không mở khoá chặn.

| Repo | Tier | Check tắt |
|---|---|---|
| `apiflow` | vendored + CI gate | không — `cm verify` phải về 0 lỗi |
| `KineTrak` | vendored | không — `enforce.grammar: true` |
| `getcontent` | vendored + CI gate | không — root scope duy nhất, xem ISS-462 (repo đó) |
| `forge-dev` (repo `forge`) | vendored + CI gate | không |
| `epodsystem-core` | vendored + CI gate | không |
| `anhome` | vendored | `enforce.grammar: false` — `eslint-plugin-code-quality` đã giữ trục
  mật độ comment ở `webapp:lint`, cố ý không chạy hai lần |
| `sidboss` | plugins (advisory) | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: sidboss ISS-159 |
| `ceo-dashboard` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: ceo-dashboard ISS-82 (`draft`, chờ triage của project đó) |
| `finance-automation` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: finance-automation ISS-78 (`draft`, chờ triage của project đó) |
| `pixelight` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: pixelight ISS-358 |
| `sidpeak` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: sidpeak ISS-351 |
| `brand-gateway` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: brand-gateway ISS-56 |
| `sidcorp-mail` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: sidcorp-mail ISS-10 |
| `sid-desk` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: sid-desk ISS-158 |
| `dodgeprint-api` | plugins (advisory) — mới ISS-4 | chặn-vì-prose tắt (chưa `cm init`) — theo dõi: dodgeprint-api ISS-73 |

**Ứng viên hợp lệ, chưa cài — để lô sau, không phải vì thiếu ranh giới.** Có `repoPath` thật, pipeline
`autonomous`, cấu trúc/gate rõ (`projectFacts` chứng minh) — chỉ đơn giản là 8 ở trên đã đủ chạm mốc
5→15 nên vòng này dừng ở đó. Liệt kê để lô sau không phải đo lại từ đầu:
`adminhub-api`, `dodgeprint-fe`, `dodgeprint-ui-v2`, `portal-lighthuman`, `server-vault`, `archmap`,
`devbox`, `forge-plugin` (repo plugin `forge` chính chủ — `pipelineConfig.mode` đã chuyển `staged`
→ `autonomous` giữa lúc phiên này đang chạy, tức là quan sát lúc đo đã lỗi thời ngay trong phiên; có
gate `npm run check` thật, là ứng viên tốt cho lô sau, không phải bị loại).

**Loại khỏi mọi lô, có lý do (không phải bỏ qua âm thầm):**

| Repo | Vì sao chưa |
|---|---|
| `mowment` | Repo-less storefront — 2 file git, không build, không có ranh giới module để gắn annotation |
| `erp`, `sid-growth`, `adminhub-ui` | `repoPath: null` trên project — chưa có repo thật để cài |
| `forge-redesign` | `repoPath` là subdir của `forge-dev` (`jarvis-agents/`) — cùng cây đã cài ở root, cài lại là trùng |
| `house-supabase` | `repoPath` trên máy cá nhân (`/Users/chuongle/...`), ngoài devbox fleet `/home/kieutrung/*` — không xác minh được ai review hook, giữ lại làm mục hỏi ở lô sau |

**Bước tiếp theo — đã mở issue, không phải chỉ ghi ý định:** 9 issue theo dõi (cột "theo dõi" ở
bảng trên) đã tạo TRONG từng project sở hữu — mỗi issue xin đúng ba việc: `cm init` (đóng băng
baseline), `cm install` (vendor + pin version), rồi wire `cm verify` vào gate CI của repo đó — mẫu
tham khảo: `getcontent` ISS-462 (ở project đó). 7/9 vào thẳng `open` (pipeline project đó tự
dispatch); 2 (`ceo-dashboard` ISS-82, `finance-automation` ISS-78) vào `draft` vì project đó có
`intakeGate`/triage thủ công — cần một người hoặc driver của project đó approve trước khi dispatch,
ISS-4 không có quyền tự chuyển trạng thái ở project khác.

"Mỗi repo có baseline riêng" trong đề bài ISS-4 mới đúng cho **6/15** (tier vendored) tại thời điểm
đóng issue này — 9 tier `plugins` CHƯA có baseline, đúng như thiết kế "đo trước, cài sau": chưa đo
thì chưa mở khoá chặn, không phải khoảng trống bị giấu, và giờ có issue theo dõi thật để đóng khoảng
trống đó. Ai đọc §10 muốn coi ISS-4 "xong" theo đúng nghĩa đề bài cần đọc dòng này trước.
