하루 5문장 영어 원서 공부 - 안드로이드 앱(APK) 만들기
==========================================================

이 폴더를 GitHub에 올리면, GitHub가 알아서 APK 파일을 만들어 줍니다.
내 컴퓨터에는 아무것도 설치하지 않아도 됩니다. (무료)

[준비물] 컴퓨터, 크롬, 이메일 주소(GitHub 가입용)

1단계. GitHub 가입
  - github.com 에서 Sign up 으로 무료 가입합니다.

2단계. 새 저장소(repository) 만들기
  - 오른쪽 위 + 버튼 > New repository
  - Repository name: english-study (아무 이름이나 OK)
  - Public / Private 중 Private(나만 보기)을 골라도 됩니다.
  - 아래 Create repository 버튼을 누릅니다.

3단계. 파일 올리기
  - 새로 만든 저장소 화면에서 "uploading an existing file" 링크를 누릅니다.
    (또는 Add file > Upload files)
  - 이 압축을 푼 폴더 안의 아래 항목을 전부 끌어다 놓습니다.
        www (폴더)
        scripts (폴더)
        package.json
        capacitor.config.json
        build-apk.yml
        README.txt
  - 아래쪽 Commit changes 버튼을 누릅니다.

4단계. "APK 만들기 설정 파일" 만들기  (가장 중요!)
  ※ .github 폴더는 숨김 폴더라서 끌어다 놓기가 안 될 수 있어요. 아래처럼 직접 만듭니다.
  - 저장소 화면에서 Add file > Create new file
  - 파일 이름 칸에 정확히 이렇게 입력합니다:
        .github/workflows/build-apk.yml
    ("/" 를 치면 폴더가 자동으로 만들어져요)
  - 큰 입력칸에, 올려 둔 build-apk.yml 파일의 내용을 전부 복사해서 붙여 넣습니다.
  - Commit changes 버튼을 누릅니다.

5단계. APK 만들기 실행
  - 저장소 위쪽 메뉴 Actions 를 누릅니다.
  - (처음이면 "I understand my workflows, go ahead and enable them" 버튼이 나올 수 있어요. 누르세요.)
  - 왼쪽 목록에서 "Build APK" 선택 > 오른쪽 "Run workflow" 버튼 > 초록색 Run workflow
  - 5~10분쯤 기다립니다. 노란 동그라미가 초록 체크(✔)로 바뀌면 성공입니다.
  - 빨간 ✖ 가 뜨면 실패입니다. 그 실행을 눌러서 빨간 줄 문구를 클로드에게 알려 주세요.

6단계. APK 내려받기
  - 성공한 실행(초록 ✔)을 누릅니다.
  - 화면 맨 아래 Artifacts 에서 english-study-apk 를 누르면 zip 이 내려받아집니다.
  - 압축을 풀면 app-debug.apk 가 있습니다.

7단계. 폰에 설치
  - app-debug.apk 를 폰으로 옮깁니다. (카카오톡 나에게 보내기, 구글 드라이브, USB 등)
  - 폰에서 파일을 누르면 "출처를 알 수 없는 앱 설치" 허용 창이 나옵니다. 허용해 주세요.
  - "Play 프로텍트" 경고가 나오면 "그래도 설치"를 누릅니다. (내가 직접 만든 앱이라 나오는 경고예요)

8단계. 알림 설정 (정확한 시간에 울리게 하기)
  - 앱 설정 탭 > 알림 시간을 정하고 "알림 허용·적용"을 누릅니다.
  - 알림 허용 창이 뜨면 허용합니다.
  - "알람 및 리마인더" 허용 화면이 뜨면 이 앱을 켭니다. (안드로이드 12 이상)
  - "테스트 알림"으로 확인해 보세요.
  - 알림이 안 울리면: 폰 설정 > 앱 > 하루 5문장 > 배터리 > "제한 없음"

[기존 웹앱 기록을 옮기고 싶다면]
  - 웹앱 설정 탭 > 백업 저장 > 파일을 폰으로 보냄
  - APK 앱 설정 탭 > 백업 불러오기

[앱 내용을 새로 바꾸고 싶을 때]
  - 저장소의 www 폴더 안 파일(예: data/packs.js)을 새 것으로 교체하고,
    5단계(Run workflow)를 다시 하면 새 APK가 만들어져요.
