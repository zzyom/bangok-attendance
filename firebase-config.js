// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에 나오는 값을 그대로 붙여 넣으세요.
// 이 값들은 공개되어도 괜찮습니다. 데이터는 로그인과 firestore.rules로 보호됩니다.
export const firebaseConfig = {
  apiKey: "AIzaSyBTsCPXbc6ZgQBQ7gNb9iTl4Fu681RoHBA",
  authDomain: "bangok-attendance-app-e7e03.firebaseapp.com",
  projectId: "bangok-attendance-app-e7e03",
  storageBucket: "bangok-attendance-app-e7e03.firebasestorage.app",
  messagingSenderId: "601469801992",
  appId: "1:601469801992:web:0c5d2d4b282c56ccc523bd"
};

// 페이지에는 보이지 않는 Firebase Auth 내부 로그인 식별자입니다.
// Firebase Authentication에 이 계정을 만들고, 모두 같은 암호를 사용합니다.
// 이메일 주소는 실제 메일 계정이 아니며 비밀번호 재설정은 Firebase 콘솔에서 합니다.
export const ACCOUNTS = {
  admin: "admin@bangok-g2.example.com"
};
