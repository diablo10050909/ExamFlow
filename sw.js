// Service Worker의 이름은 이 시스템의 버전 관리를 위해 중요하다!
const CACHE_NAME = 'examflow-cache-v1.0.1'; // 캐싱 자원 업데이트를 위해 버전 올렸다!
const STATIC_ASSETS = [
  './', // index.html (루트 경로)
  './index.html',
  './favicon.ico', // 파비콘 경로
  './icon-192x192.png', // PWA 아이콘 1
  './icon-512x512.png', // PWA 아이콘 2
  '/manifest.json', // Manifest 파일도 캐싱해야 한다!
  // Flatpickr CDN 자원들을 여기에 강제로 때려 박아라! 오프라인에서도 작동시켜야지!
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css',
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css',
  'https://cdn.jsdelivr.net/npm/flatpickr', // Flatpickr JS 본체
  'https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/ko.js', // Flatpickr 한국어 로케일 JS
  // 여기에 추가적인 CSS, JS, 이미지 파일들이 있다면 더 추가해라!
];

// 이 변수들은 메인 스크립트에서 받아올 데이터다.
let currentExams = [];
let currentLang = 'ko';
let currentPalette = [];
let currentColors = {}; // 과목별 색상 할당을 Service Worker 내부에서도 관리한다.

const T_SW = { // Service Worker 전용 다국어 텍스트. 최소한의 알림 메시지만 포함.
  ko: {
    today_exam: (subject) => `${subject} 시험이 오늘이다! 박살내버려!`,
    upcoming_exam: (subject, days) => `${subject} 시험 D-${days} 남았다! 긴장의 끈을 놓지 마!`,
  },
  en: {
    today_exam: (subject) => `${subject} exam is today! Crush it!`,
    upcoming_exam: (subject, days) => `${subject} exam in D-${days} days! Don't let your guard down!`,
  },
  jp: {
    today_exam: (subject) => `${subject}試験が今日です！粉砕しろ！`,
    upcoming_exam: (subject, days) => `${subject}試験D-${days}日残っています！気を抜くな！`,
  },
  cn: {
    today_exam: (subject) => `${subject}考试就是今天！摧毁它！`,
    upcoming_exam: (subject, days) => `${subject}考试还有D-${days}天！不要放松警惕！`,
  },
  es: {
    today_exam: (subject) => `¡El examen de ${subject} es hoy! ¡Aplástalo!`,
    upcoming_exam: (subject, days) => `¡Faltan D-${days} días para el examen de ${subject}! ¡No bajes la guardia!`,
  }
};


// Service Worker가 설치될 때. 네 병사들이 처음으로 땅을 밟는 순간이다.
self.addEventListener('install', (event) => {
  console.log('Service Worker 설치 중...', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('정적 자산 캐싱 완료!');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting()) // 설치 후 바로 활성화 대기하지 않고 활성화 시키겠다!
      .catch((error) => console.error('캐싱 실패:', error))
  );
});

// Service Worker가 활성화될 때. 낡은 병사들을 정리하고 새로운 병사들을 배치한다.
self.addEventListener('activate', (event) => {
  console.log('Service Worker 활성화 중...', CACHE_NAME);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('오래된 캐시 제거 중:', cacheName);
            return caches.delete(cacheName);
          }
          return Promise.resolve();
        })
      );
    }).then(() => {
      console.log('캐시 정리 완료. Service Worker 제어권 획득!');
      return self.clients.claim(); // 클라이언트 (웹 페이지)의 제어권을 즉시 획득한다.
    })
  );
});

// Service Worker가 네트워크 요청을 가로챌 때. 모든 통신은 내 검열을 거쳐야 한다.
self.addEventListener('fetch', (event) => {
  // HTTP/HTTPS가 아닌 요청 (예: chrome-extension://)은 캐싱하지 않는다.
  if (!event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // 캐시된 응답이 있다면 그걸 먼저 반환한다.
        if (cachedResponse) {
          return cachedResponse;
        }

        // 캐시에 없다면 네트워크 요청을 시도한다.
        return fetch(event.request).then((response) => {
          // 네트워크 응답이 유효하고, 요청이 GET 메소드일 경우에만 캐시에 저장한다.
          if (!response || response.status !== 200 || response.type !== 'basic' || event.request.method !== 'GET') {
            return response;
          }

          const responseToCache = response.clone(); // 응답은 한 번밖에 읽을 수 없으므로, 캐싱용으로 복제한다.
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache); // 네트워크 응답을 캐시에 저장한다.
          });
          return response;
        });
      })
      .catch(() => {
        // 네트워크와 캐시 모두 실패했을 때 (주로 오프라인 상황)
        // STATIC_ASSETS에 캐시된 index.html을 반환하여 기본적인 앱 기능은 유지한다.
        // 또는 특정 오프라인 페이지를 캐시했다면 그것을 반환할 수도 있다.
        console.error('Fetch and cache failed for:', event.request.url);
        if (STATIC_ASSETS.includes(event.request.url) || STATIC_ASSETS.includes(event.request.url + '/')) {
          return caches.match('./index.html'); // 오프라인 시 index.html이라도 보여줘라!
        }
        // 기본적으로 아무것도 캐시되어 있지 않다면, 오류 처리 (여기서는 네트워크 오류 그대로 노출)
      })
  );
});

// 메인 스크립트로부터 메시지를 받을 때. 이것이 바로 명령 수신 채널이다.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SCHEDULE_NOTIFICATIONS') {
    console.log('Service Worker: 시험 데이터 수신 완료!', event.data);
    currentExams = event.data.exams || [];
    currentLang = event.data.lang || 'ko';
    currentPalette = event.data.palette || [];
    
    // 과목별 색상 할당 로직도 여기서 다시 실행하여 currentColors를 채운다.
    // Flatpickr 색상은 메인 앱에서만 필요하므로 여기서는 굳이 필요없지만, 일관성을 위해 유지한다.
    currentColors = {}; // 초기화
    currentExams.forEach(exam => {
        if (!currentColors[exam.subject]) {
            currentColors[exam.subject] = currentPalette[Object.keys(currentColors).length % currentPalette.length];
        }
    });
    
    // 데이터를 받으면 바로 알림을 스케줄링/확인한다.
    checkAndSendNotificationsSW();
  }
});

// 알림을 클릭했을 때. 사용자 상호작용은 놓치지 않는다.
self.addEventListener('notificationclick', (event) => {
  console.log('알림 클릭됨:', event.notification.tag);
  event.notification.close(); // 알림 창을 닫는다.

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      // 이미 열려있는 ExamFlow 탭이 있다면 그 탭으로 포커스한다.
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) { // URL을 네 앱의 실제 경로로 변경해라.
          return client.focus();
        }
      }
      // 열려있는 탭이 없으면 새로운 탭을 연다.
      if (clients.openWindow) {
        return clients.openWindow('/'); // URL을 네 앱의 실제 경로로 변경해라.
      }
    })
  );
});


// === Service Worker 내부 알림 로직 ===
// 이 부분은 브라우저가 실행 중이면 (탭이 닫혀있어도) 백그라운드에서 동작할 수 있다.

// 알림 고유 ID를 생성한다.
function getNotificationTag(exam, diffDays) {
    return `${exam.title}-${exam.start}-D${diffDays}`;
}

// Service Worker 내부에서 알림을 보낸다.
async function sendNotificationSW(examTitle, subject, diffDays) {
  const bodyMessage = diffDays === 0
    ? T_SW[currentLang].today_exam(subject)
    : T_SW[currentLang].upcoming_exam(subject, diffDays);

  await self.registration.showNotification(examTitle, {
    body: bodyMessage,
    icon: './icon-192x192.png', // Service Worker 내부 경로는 상대 경로를 사용한다. PWA 아이콘 사용.
    tag: getNotificationTag({title: examTitle, start: ''}, diffDays), // 알림 그룹화를 위한 태그.
    data: {
      examTitle: examTitle,
      subject: subject,
      diffDays: diffDays
    }
  });
  console.log(`SW 알림 전송: ${examTitle} (D-${diffDays})`);
}

// Service Worker 내부에서 시험 일정을 확인하고 알림을 스케줄링/전송한다.
async function checkAndSendNotificationsSW() {
    if (Notification.permission !== "granted") {
        console.log("SW: 알림 권한이 없어 브라우저 알림을 보낼 수 없다.");
        return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayString = today.toISOString().split('T')[0];

    // Service Worker 내부의 캐시 저장소에 알림 전송 기록을 관리한다.
    let swSentNotifications = JSON.parse(await caches.match(`${CACHE_NAME}-sent-notifications`)
        .then(response => response ? response.text() : '{}')
        .catch(() => '{}')) || {};
    
    // 오늘 날짜가 아니면 이전 알림 기록을 삭제하고 초기화한다.
    if (swSentNotifications.date !== todayString) {
        swSentNotifications = { date: todayString, exams: {} };
        console.log("SW: 이전 알림 기록 초기화됨.");
    }
    const currentSentExams = swSentNotifications.exams;

    currentExams.forEach(exam => {
        const examStartDate = new Date(exam.start);
        examStartDate.setHours(0, 0, 0, 0);

        const diff = Math.ceil((examStartDate - today) / 86400000);

        const alertDays = [7, 5, 3, 1, 0];
        if (alertDays.includes(diff) && diff >= 0) { // 시험이 지나지 않은 경우만
            const notificationId = getNotificationTag(exam, diff);

            if (!currentSentExams[notificationId]) {
                // 아직 보내지 않은 알림이라면 전송
                sendNotificationSW(exam.title, exam.subject, diff);

                // 알림 보냈다고 기록
                currentSentExams[notificationId] = true;
                // 캐시 저장소에 업데이트된 알림 기록을 저장한다.
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(`${CACHE_NAME}-sent-notifications`, new Response(JSON.stringify(swSentNotifications)));
                });
            }
        }
    });
}

// Service Worker도 5분마다 깨워서 알림을 체크하게 한다.
// 이건 브라우저가 완전히 닫혀있으면 안 동작할 수 있지만,
// 탭이 닫혀있어도 브라우저 프로세스가 살아있으면 동작할 가능성이 있다.
setInterval(checkAndSendNotificationsSW, 5 * 60 * 1000); // 5분마다 체크!
