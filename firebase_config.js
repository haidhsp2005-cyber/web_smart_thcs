// firebase_config.js - Cấu hình & Quản lý Kết nối Đám Mây Google Firebase Firestore cho SmartEdu THCS

/**
 * CẤU HÌNH GOOGLE FIREBASE CLOUD DATABASE:
 * - Để kết nối tới dự án Firebase của bạn:
 *   1. Truy cập https://console.firebase.google.com (đăng nhập bằng Google).
 *   2. Tạo dự án mới (ví dụ: SmartEdu-THCS).
 *   3. Bấm vào icon Web </>, đặt tên ứng dụng và sao chép đối tượng firebaseConfig dán vào bên dưới.
 *   4. Trong menu bên trái, vào "Build" -> "Firestore Database" -> "Create Database" (chọn test mode để bắt đầu ngay).
 */
window.FIREBASE_CONFIG = window.FIREBASE_CONFIG || {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// ================= SMARTEDU CLOUD SYNC MODULE =================
(function() {
  const CloudDB = {
    isFirebaseReady: false,
    db: null,
    listeners: [],

    // Khởi tạo Firebase
    init() {
      // 1. Kiểm tra cấu hình lưu trong localStorage trước (nếu người dùng đã cấu hình trong UI)
      try {
        const savedConfig = localStorage.getItem('smartedu_firebase_custom_config');
        if (savedConfig) {
          const parsed = JSON.parse(savedConfig);
          if (parsed && parsed.projectId) {
            window.FIREBASE_CONFIG = parsed;
          }
        }
      } catch (e) {}

      // 2. Thử khởi tạo Firebase nếu có projectId
      if (window.firebase && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.projectId && window.FIREBASE_CONFIG.projectId.trim() !== '') {
        try {
          if (!firebase.apps.length) {
            firebase.initializeApp(window.FIREBASE_CONFIG);
          }
          this.db = firebase.firestore();
          this.isFirebaseReady = true;
          console.log('✅ Google Firebase Firestore đã kết nối thành công:', window.FIREBASE_CONFIG.projectId);
        } catch (err) {
          console.warn('⚠️ Lỗi khởi tạo Firebase, chuyển sang chế độ Đồng bộ Cục bộ:', err);
          this.isFirebaseReady = false;
        }
      } else {
        console.log('ℹ️ Firebase chưa có cấu hình; sử dụng Cloud Local Storage Cache.');
        this.isFirebaseReady = false;
      }
    },

    // Kiểm tra trạng thái kết nối
    getStatus() {
      return {
        online: navigator.onLine,
        isFirebase: this.isFirebaseReady,
        projectId: window.FIREBASE_CONFIG?.projectId || 'Chế độ Cục bộ (Local Cloud)'
      };
    },

    // Đăng ký tài khoản mới lên Web
    async registerUser(username, password, profileData) {
      const cleanUsername = username.trim().toLowerCase();
      
      // Chuẩn bị payload tài khoản
      const userPayload = {
        username: cleanUsername,
        password: password, // Mã PIN hoặc mật khẩu
        profile: {
          name: profileData.name || 'Học sinh',
          grade: profileData.grade || '9',
          className: profileData.className || '9A1',
          school: profileData.school || 'THCS',
          avatar: profileData.avatar || '👨‍🎓',
          createdAt: new Date().toLocaleDateString('vi-VN'),
          lastLogin: new Date().toLocaleString('vi-VN')
        },
        scores: [],
        mindmaps: [],
        summaries: [],
        flashcards: []
      };

      if (this.isFirebaseReady && this.db) {
        try {
          const docRef = this.db.collection('users').doc(cleanUsername);
          const doc = await docRef.get();
          if (doc.exists) {
            return { success: false, message: 'Tên đăng nhập này đã có người sử dụng. Vui lòng chọn tên khác!' };
          }
          await docRef.set(userPayload);
          // Lưu sao chép cục bộ
          this._saveLocalUser(userPayload);
          return { success: true, user: userPayload };
        } catch (e) {
          console.error('Lỗi đăng ký Firebase:', e);
          return { success: false, message: 'Lỗi kết nối Firebase: ' + (e.message || e) };
        }
      } else {
        // Lưu trên kho Local Cloud
        const localUsers = this._getLocalUsers();
        if (localUsers[cleanUsername]) {
          return { success: false, message: 'Tên đăng nhập này đã tồn tại trên thiết bị này!' };
        }
        localUsers[cleanUsername] = userPayload;
        this._setLocalUsers(localUsers);
        return { success: true, user: userPayload };
      }
    },

    // Đăng nhập tài khoản từ Web
    async loginUser(username, password) {
      const cleanUsername = username.trim().toLowerCase();

      if (this.isFirebaseReady && this.db) {
        try {
          const docRef = this.db.collection('users').doc(cleanUsername);
          const doc = await docRef.get();
          if (!doc.exists) {
            return { success: false, message: 'Tên tài khoản không tồn tại trên hệ thống Web!' };
          }
          const userData = doc.data();
          if (userData.password && userData.password !== password) {
            return { success: false, message: 'Mật khẩu hoặc mã PIN không chính xác!' };
          }
          // Cập nhật lastLogin
          userData.profile = userData.profile || {};
          userData.profile.lastLogin = new Date().toLocaleString('vi-VN');
          await docRef.update({ 'profile.lastLogin': userData.profile.lastLogin });

          // Lưu cache vào local
          this._saveLocalUser(userData);
          return { success: true, user: userData };
        } catch (e) {
          console.error('Lỗi đăng nhập Firebase:', e);
          // Thử tìm trong local cache nếu rớt mạng
          const localUsers = this._getLocalUsers();
          const localUser = localUsers[cleanUsername];
          if (localUser && localUser.password === password) {
            return { success: true, user: localUser, isOffline: true };
          }
          return { success: false, message: 'Không thể kết nối đến máy chủ: ' + (e.message || e) };
        }
      } else {
        // Tìm trong kho Local Cloud
        const localUsers = this._getLocalUsers();
        const user = localUsers[cleanUsername];
        if (!user) {
          return { success: false, message: 'Tên tài khoản không tồn tại!' };
        }
        if (user.password && user.password !== password) {
          return { success: false, message: 'Mật khẩu hoặc mã PIN không chính xác!' };
        }
        user.profile.lastLogin = new Date().toLocaleString('vi-VN');
        this._setLocalUsers(localUsers);
        return { success: true, user: user };
      }
    },

    // Lưu toàn bộ dữ liệu tài khoản lên Web
    async syncUserData(userData) {
      if (!userData || !userData.username) return;
      const cleanUsername = userData.username.trim().toLowerCase();

      // Lưu cache cục bộ trước
      this._saveLocalUser(userData);

      // Đẩy lên Firebase nếu kết nối khả dụng
      if (this.isFirebaseReady && this.db) {
        try {
          const docRef = this.db.collection('users').doc(cleanUsername);
          await docRef.set(userData, { merge: true });
          console.log('☁️ Đã đồng bộ dữ liệu lên Firebase Cloud thành công cho:', cleanUsername);
          return true;
        } catch (e) {
          console.warn('⚠️ Lỗi đồng bộ Firebase Cloud (đã lưu cache cục bộ):', e);
          return false;
        }
      }
      return true;
    },

    // Các hàm phụ trợ lưu trữ cache
    _getLocalUsers() {
      try {
        return JSON.parse(localStorage.getItem('smartedu_cloud_local_users') || '{}');
      } catch (e) {
        return {};
      }
    },

    _setLocalUsers(usersObj) {
      try {
        localStorage.setItem('smartedu_cloud_local_users', JSON.stringify(usersObj));
      } catch (e) {}
    },

    _saveLocalUser(userData) {
      if (!userData || !userData.username) return;
      const users = this._getLocalUsers();
      users[userData.username] = userData;
      this._setLocalUsers(users);
    }
  };

  // Khởi chạy module
  window.SmartEduCloud = CloudDB;
  CloudDB.init();
})();
