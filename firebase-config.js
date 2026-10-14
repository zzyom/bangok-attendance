// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에 나오는 값을 그대로 붙여 넣으세요.
// 이 값들은 공개되어도 괜찮습니다. 데이터는 로그인과 firestore.rules로 보호됩니다.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

// Firebase Authentication에 만들어 둘 공용 계정 두 개.
// 바꾸면 firestore.rules의 이메일도 똑같이 바꿔야 합니다.
export const ACCOUNTS = {
  teacher: "teacher@bangok-g2.example.com", // 선생님 공용 비밀번호
  admin: "admin@bangok-g2.example.com"      // 학년부장 비밀번호 (마감·명렬·백업)
};
