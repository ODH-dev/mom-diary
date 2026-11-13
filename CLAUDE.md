# 엄마의 일기장 (mom-diary)

엄마가 글·목소리로 일기를 쓰고, 아들(동탁·동학)이 읽고 반응·답장하는 웹앱.
**엄마가 실제로 매일 쓰는 서비스라서, 끊기지 않게 하는 것이 최우선.**

## 구조

| 위치 | 역할 | 배포 |
|---|---|---|
| `index.html` | 화면 전체 (HTML/CSS/JS 한 파일). `manifest.webmanifest`·`icon-*.png`·`apple-touch-icon.png`은 홈 화면 아이콘용 | GitHub Pages: `main` 브랜치에 push하면 https://odh-dev.github.io/mom-diary/ 에 반영 |
| `server/Code.js` | Apps Script 서버 (`doPost` API) | clasp로 push한 뒤 배포 |
| `server/appsscript.json` | Apps Script 설정 (웹앱: 배포자 권한으로 실행, 익명 접근 허용) | 위와 같음 |
| `server/Index.html` | 예전 Apps Script 안 화면. 지금 `doGet`은 이 파일을 쓰지 않음 | 위와 같음 |
| `server/.clasp.json` | scriptId (비밀값 아님) | - |

- Apps Script 프로젝트 ID: `1wIM2d-c4tnrtgVlgPJNYQDhY829KJOk18D4Pz1FJ30hvt_UJ7Mo56Gdo`
- **웹앱 배포 ID (고정): `AKfycbwBN4vqze8nUU_T6rZX3fFUSTNwmNDfPSskkxuZPFpuGvWBOLtKqnDSv_jU2YW7ZN2YMw`**
  `index.html`의 `var API = ...`가 이 주소를 부름. 새 배포를 만들지 말고 항상 이 ID를 업데이트할 것.
- 데이터: 구글 시트 `SHEET_ID`(Code.js), 탭 `일기` / `반응`. 녹음·사진은 드라이브 폴더 `엄마의 일기장 녹음`.
  - `일기` 열: id, 날짜, 날씨, 기분, 내용, 처음 쓴 시각, 고친 시각, 녹음 파일, 사진 파일
  - `반응` 종류: `read` · `react` · `reply`(아들, 그리고 엄마의 되답장) · `ask`(아들 질문, 일기id 칸에 `q-…`) · `answer`(질문 → 답한 일기 id) · `dismiss`(엄마가 '다음에')

### API
화면은 `POST {fn, args, key}`를 보냄 (`Content-Type: text/plain`, CORS 사전 요청을 피하려고).
`key`는 화면에서 입력한 비밀번호. 응답은 `{ok, result}` 또는 `{ok:false, error}`.
- 엄마 전용: `getRecent`, `saveEntry`(글·녹음·사진, `answer`로 질문 연결), `deleteEntry`, `dismissQuestion`
- 가족: `getAllForFamily`, `markRead`, `react`, `reply`(엄마도 가능), `ask`(아들만), `getQuestions` (함수 안에서 PIN 확인)
- `getAudio`, `getPhoto`: 엄마 또는 가족 PIN

## 비밀값: 코드·저장소에 절대 적지 않기
저장소가 **공개**라서, 비밀번호는 Apps Script **스크립트 속성**에만 둔다.
(편집기 → 프로젝트 설정 ⚙️ → 스크립트 속성)

| 속성 | 형식 |
|---|---|
| `PINS` | JSON `{"비밀번호":"이름", ...}`. 이름은 `엄마`/`동탁`/`동학` |
| `MOM_KEY` | 더 이상 쓰지 않음 (2026-11-13 정리). 지워도 됨 |
| `FMT`, `FOLDER_ID` | 코드가 직접 관리함. 건드리지 말 것 |

- 속성이 비어 있거나 JSON이 깨지면 **모든 요청이 거절됨** (열려 버리지 않게 막아 둔 것).
- 비밀번호를 바꿀 때는 속성만 고치면 되고, 다시 배포할 필요 없음.
- 커밋 전에 `git diff`에 비밀번호나 열쇠가 들어 있지 않은지 확인할 것.

## 개발·배포

clasp는 `~/.local/bin/clasp`에 설치돼 있음 (전역 npm 권한 문제 때문에 사용자 폴더에 설치).
로그인: `~/.local/bin/clasp login` (`~/.clasprc.json`에 저장됨)

### 화면 (index.html)
1. 수정한 뒤 로컬에서 열어 확인 (실제 API를 부르므로, 시험할 때 저장·삭제는 조심)
2. `git commit` 후 `git push`. 1~2분 뒤 Pages에 반영됨

### 서버 (server/): 서비스가 끊기지 않는 순서
배포 ID는 특정 **버전**에 고정돼 있음. `clasp push`는 HEAD만 바꾸므로 실제 사이트에는 영향이 없음.
```sh
cd server
clasp push -f                                   # HEAD에 올리기 (실제 사이트 영향 없음)
clasp create-version "무엇을 바꿨는지"              # 새 버전 번호 N 생성
clasp create-deployment -V N -d "TEMP test"     # 임시 배포로 먼저 시험
#   → 임시 주소로 읽기 요청 시험 (아래 '확인 방법')
clasp update-deployment AKfycbwBN4vqze8nUU_T6rZX3fFUSTNwmNDfPSskkxuZPFpuGvWBOLtKqnDSv_jU2YW7ZN2YMw -V N -d "설명"
#   → 실제 주소로 다시 시험
clasp delete-deployment <임시 배포 ID>
```
- 스크립트 속성이 새로 필요한 변경이면 **속성을 먼저 넣고** 배포할 것.
- 되돌리기: `clasp list-versions`로 이전 버전 번호를 찾아 `clasp update-deployment <고정 ID> -V <이전 번호>`.
- 새 권한(OAuth 범위)이 필요한 코드면 편집기에서 한 번 실행해 승인해야 웹앱이 동작함.
- `Code.js` 바꾼 뒤에는 `git commit`도 잊지 말 것 (저장소가 서버 코드의 원본).

### 확인 방법 (읽기 요청만)
```sh
curl -sL -H 'Content-Type: text/plain;charset=utf-8' \
  --data '{"fn":"getAllForFamily","args":["<PIN>"],"key":"<PIN>"}' \
  https://script.google.com/macros/s/<배포ID>/exec
```
- `-X POST`를 붙이면 안 됨. 302 리다이렉트를 따라갈 때도 POST를 보내서 에러 HTML이 옴. `--data`만 쓰면 curl이 리다이렉트 때 GET으로 바꿔 줌.
- 확인할 것: 엄마 PIN으로 `getRecent` 성공, 아들 PIN으로 `getAllForFamily` 성공(`who` 맞는지), 틀린 PIN·빈 key·`constructor` 거절.
- 일기 내용은 개인적인 것이므로 출력할 때 개수만 볼 것.

## 화면 기능 메모 (2026-11-13 업그레이드)
- 카톡으로 알리기: 저장·반응·답장·질문 뒤 아래쪽에 뜨는 카드. `navigator.share`(폰 공유 창) → 안 되면 문장+주소를 복사.
- 질문: 아들 화면 위 "엄마한테 물어보기", 엄마 화면 위 "아들이 물어봤어요" → "일기로 답하기"로 저장하면 연결됨.
- 사진: 화면에서 긴 쪽 1600px JPEG로 줄여서 올림. 카드에 자동으로 불러옴(동시 2개).
- 글씨 크기: 오른쪽 위 "가가" 버튼, `--fs`(1 / 1.15 / 1.3), localStorage `fs`.
- 홈 화면 추가: 안드로이드 크롬 `beforeinstallprompt`가 오면 안내 카드. 아이콘은 `manifest.webmanifest`.
- 목소리 → 글자 자동 변환은 넣지 않음: 갤럭시 크롬에서 녹음과 음성 인식을 동시에 돌리면 녹음이 망가질 수 있어서. 글로 쓰기 탭의 키보드 마이크를 쓰도록 안내.
