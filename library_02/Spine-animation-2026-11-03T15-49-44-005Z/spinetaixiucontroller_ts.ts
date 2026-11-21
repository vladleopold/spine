import { _decorator, Component, Node } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('SpineTaiXiuController')
export class SpineTaiXiuController extends Component {

    // Tham chiếu đến component Skeleton của Spine (Đĩa & Nắp hoặc Xúc xắc Spine)
    @property(sp.Skeleton)
    public tableSpine: sp.Skeleton = null!;

    // Tên các animation trong file Spine của bạn (Cần khớp với tên animation đã setup trong Spine Editor)
    private readonly ANIM_IDLE = "idle";         // Trạng thái chờ / đậy nắp
    private readonly ANIM_SHAKE = "shake";       // Hoạt ảnh đang lắc đĩa
    private readonly ANIM_OPEN = "open";         // Hoạt ảnh mở nắp đậy ra
    private readonly ANIM_CLOSE = "close";       // Hoạt ảnh đậy nắp lại

    start() {
        // Khởi tạo trạng thái ban đầu (đậy nắp, đứng yên)
        this.playIdleState();
    }

    /**
     * Trạng thái chờ (Idle)
     */
    public playIdleState() {
        if (this.tableSpine) {
            // Lặp lại animation idle
            this.tableSpine.setAnimation(0, this.ANIM_IDLE, true);
        }
    }

    /**
     * Bắt đầu hiệu ứng lắc đĩa / xí ngầu
     * @param onComplete Callback được gọi khi lắc xong
     */
    public playShakeAnimation(onComplete?: () => void) {
        if (!this.tableSpine) return;

        // Chạy animation shake 1 lần (false)
        let trackEntry = this.tableSpine.setAnimation(0, this.ANIM_SHAKE, false);

        if (trackEntry) {
            // Đăng ký lắng nghe sự kiện khi animation lắc chạy xong
            this.tableSpine.setCompleteListener((entry) => {
                if (entry && entry.animation && entry.animation.name === this.ANIM_SHAKE) {
                    // Xóa listener để tránh gọi lặp lại
                    this.tableSpine.setCompleteListener(null);
                    if (onComplete) {
                        onComplete();
                    }
                }
            });
        }
    }

    /**
     * Hiệu ứng mở nắp để lộ kết quả xúc xắc bên trong
     * @param onOpened Callback sau khi mở nắp hoàn tất
     */
    public playOpenLidAnimation(onOpened?: () => void) {
        if (!this.tableSpine) return;

        let trackEntry = this.tableSpine.setAnimation(0, this.ANIM_OPEN, false);

        if (trackEntry) {
            this.tableSpine.setCompleteListener((entry) => {
                if (entry && entry.animation && entry.animation.name === this.ANIM_OPEN) {
                    this.tableSpine.setCompleteListener(null);
                    if (onOpened) {
                        onOpened();
                    }
                }
            });
        }
    }

    /**
     * Hiệu ứng đậy nắp lại chuẩn bị cho ván mới
     */
    public playCloseLidAnimation(onClosed?: () => void) {
        if (!this.tableSpine) return;

        let trackEntry = this.tableSpine.setAnimation(0, this.ANIM_CLOSE, false);

        if (trackEntry) {
            this.tableSpine.setCompleteListener((entry) => {
                if (entry && entry.animation && entry.animation.name === this.ANIM_CLOSE) {
                    this.tableSpine.setCompleteListener(null);
                    // Sau khi đóng nắp xong, chuyển về trạng thái Idle chờ ván mới
                    this.playIdleState();
                    if (onClosed) {
                        onClosed();
                    }
                }
            });
        }
    }
}