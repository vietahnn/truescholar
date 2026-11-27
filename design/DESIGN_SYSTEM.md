# TrueScholar MVP — Design System Specification

> Tài liệu khóa phong cách UI cho toàn bộ ứng dụng `MVP-schorlartrue` (triển khai Vercel).
> Mọi màn hình bắt buộc tuân thủ cùng một bảng màu phẳng, kiểu chữ và nguyên tắc bố cục.

## 1. Nguyên tắc cốt lõi
- **100% Flat Design:** Tuyệt đối **không** sử dụng màu gradient (nền, nút bấm, viền, biểu đồ), không dùng hiệu ứng glassmorphism hay đổ bóng dày.
- **Không dùng icon vô tri:** Không thêm sparkle (`✨`), robot/mascot AI, emoji trang trí, hay icon minh họa lặp cạnh mọi tiêu đề/thẻ. Ưu tiên chữ viết rõ ràng, cấu trúc lưới và viền mảnh `1px`.
- **Chữ số căn thẳng hàng:** Dùng `font-variant-numeric: tabular-nums` cho điểm số, hạn nộp, tỉ lệ phần trăm, số trang và số lượt.

## 2. Bảng màu (Solid Flat Tokens)
| Token | Hex | Vai trò |
|---|---|---|
| `--bg-canvas` | `#F7F7F5` | Nền trang chính (Warm Alabaster) |
| `--bg-surface` | `#FFFFFF` | Card, Sidebar, Drawer, Input |
| `--bg-recessed` | `#F1F1ED` | Bubble câu hỏi SV, hộp đoạn trích, track tab |
| `--border-default` | `#E4E4E0` | Viền card, sidebar, ngăn cách bảng (`1px solid`) |
| `--border-input` | `#D4D4CE` | Viền ô nhập liệu (`1px solid`) |
| `--text-primary` | `#141413` | Tiêu đề, nội dung chính |
| `--text-muted` | `#5C5C58` | Nhãn phụ, metadata, cột header bảng |
| `--accent-primary` | `#1E3A8A` | Nút chính, viền active, chữ active, monogram |
| `--accent-tint` | `#EEF2FF` | Nền mục sidebar đang chọn, chip trích nguồn `[1]` |
| `--status-success-bg` / `-fg` | `#ECFDF5` / `#065F46` | Đang mở, Bài học, Đã chấm, Đạt |
| `--status-warn-bg` / `-fg` | `#FFFBEB` / `#92400E` | Chờ duyệt, Nghi là đáp án |
| `--status-sealed-bg` / `-fg` | `#FEF2F2` / `#991B1B` | Vùng kín (Sealed), Đáp án chỉ GV xem |

## 3. Kiểu chữ (Typography)
- **Font chính (UI & nội dung):** `Inter` (geometric sans-serif)
- **Font phụ (chỉ cho mã môn, công thức toán, đoạn code):** `JetBrains Mono`
- **Tỉ lệ chữ:**
  - Page Title: `20px` / `600` (`-0.015em`)
  - Section / Card Title: `15px` / `600`
  - Body / Chat text: `14px` / `400` (`line-height: 1.6`)
  - Label / Table Header / Pill: `12px` / `500`

## 4. Khung bố cục (App Shell)
- **Sidebar trái cố định (`230px`):** Nền `#FFFFFF`, viền phải `1px solid #E4E4E0`. Trên cùng là monogram vuông phẳng `#1E3A8A` chữ `T` + wordmark `TrueScholar` + pill vai trò (`Sinh viên` / `Giảng viên`). Menu điều hướng chỉ dùng text + thanh active bên trái hoặc nền `#EEF2FF` (không gắn icon vô tri). Dưới cùng là tên/tài khoản và nút `Đăng xuất`.
- **Vùng nội dung chính:** Nền `#F7F7F5`, padding `24px–32px`, chia 2 cột rõ ràng hoặc bảng phẳng + form biên soạn.

## 5. Danh sách ảnh Prototype (`design/`)
1. `01-login.png` — Trang Đăng nhập (chọn vai trò demo Sinh viên / Giảng viên)
2. `02-student-chat.png` — Sinh viên: Trợ lý học thuật (Chat AI trích nguồn + Trình xem tài liệu nguồn)
3. `03-student-assignments.png` — Sinh viên: Bài tập của tôi (Làm bài, gợi ý theo bậc, kết quả chấm)
4. `04-lecturer-documents-review.png` — Giảng viên: Upload & Hàng chờ duyệt tài liệu (HITL + cách ly mục nghi đáp án)
5. `05-lecturer-assignments-analytics.png` — Giảng viên: Soạn bài tập, khóa đáp án vùng kín & Thống kê lớp
