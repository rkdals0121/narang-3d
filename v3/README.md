# 나랑이 3D v3

키오스크·여객 화면에 넣기 위한 ES 모듈 버전입니다. v1(`/`)과 v2(`/v2/`)는 그대로 두었습니다.

- 데모: https://rkdals0121.github.io/narang-3d/v3/
- 원본과 비교: https://rkdals0121.github.io/narang-3d/v3/compare.html

## 파일

| 파일 | 내용 | 크기 |
|---|---|---|
| `narang.js` | 뷰어 모듈 (`createNarang`, `canRender3D`, `EXPRESSIONS`) | 38KB |
| `models/narang_lite.glb` | 앉은 모델 경량판: 삼각형 10만, 텍스처 1024 WebP, meshopt | 1.06MB |
| `models/narang_full.glb` | 앉은 모델 고화질판: 삼각형 37만, 텍스처 2048 WebP, meshopt | 3.16MB |
| `models/sleep.glb` | 엎드린 모델: 삼각형 1.6만, WebP, meshopt | 0.27MB |
| `posters/awake.webp`, `posters/sleep.webp` | WebGL이 없거나 움직임 줄이기일 때 쓸 정지 그림 (투명 배경) | 37KB / 81KB |
| `compare/` | 원본 그림과 3D 비교 캡처, 손 흔들기 캡처 | |
| `vendor/three/` | 데모 페이지용 three 0.187.0 (웹앱에서는 npm `three`를 씀) | |

모델은 `EXT_meshopt_compression`, `KHR_mesh_quantization`, `EXT_texture_webp`를 씁니다. three의 `GLTFLoader` + `MeshoptDecoder`로 읽으며, 디코더는 `three/addons/libs/meshopt_decoder.module.js`에 포함돼 있어 wasm 파일을 따로 둘 필요가 없습니다.

## 사용법

```js
import { createNarang, canRender3D } from './narang.js';

const n = createNarang(canvas, {
  model: '/narang/narang_lite.glb',
  sleepModel: '/narang/sleep.glb',
  mood: 'sleep',            // 'sleep' | 'awake' | 'happy'
  sleepPose: 'sit',         // 'sit' = 앉아서 졸기, 'lie' = 엎드려 자기
  // reducedMotion: 기본값은 OS의 '동작 줄이기' 설정
  // lookAtPointer: true, dragToRotate: true, tapToJump: true
  // background: null → 투명 배경
  onReady: () => {}, onError: (e) => {}, onChange: ({ mood, pose, busy }) => {}
});

n.wake();               // 탑승권 인식·화면 터치 → 깨어남 (약 3.5초 연출 후 웃음)
n.setMood('awake');     // 안내 중: 웃음
n.jump();               // 완료: 깔깔 + 점프 + 반짝이
n.setMood('happy');     // 계속 깔깔 웃는 얼굴
n.sleep('sit');         // 다시 대기
n.wave();               // 손 흔들기 (실험적, 아래 참고)
n.setExpression('wink');// smile | laugh | wink | surprise | sad | sleep
n.dispose();            // 정리. 같은 canvas로 다시 createNarang 가능
n.dispose({ releaseContext: true }); // canvas 자체를 버릴 때만
```

- 크기: canvas의 부모 요소 크기를 ResizeObserver로 따라갑니다. 부모에 정사각형 크기를 주면 됩니다(예: 1920×1080에서 650px, 1080×1920에서 폭의 60%).
- 화면 밖에 있거나 탭이 숨겨지면 렌더를 멈춥니다(IntersectionObserver, visibilitychange).
- `canRender3D()`가 false거나 `prefers-reduced-motion`이면 `posters/*.webp`를 쓰는 걸 권합니다. 데모 페이지가 그렇게 동작합니다.

### Next.js (App Router) 예시

```tsx
'use client';
import { useEffect, useRef } from 'react';

export default function Narang3D({ mood }: { mood: 'sleep' | 'awake' | 'happy' }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const api = useRef<any>(null);
  useEffect(() => {
    let alive = true;
    import('./narang').then(({ createNarang }) => {
      if (!alive || !ref.current) return;
      api.current = createNarang(ref.current, { model: '/narang/narang_lite.glb', sleepModel: '/narang/sleep.glb', mood });
    });
    return () => { alive = false; api.current?.dispose(); api.current = null; };
  }, []);
  useEffect(() => { api.current?.setMood(mood); }, [mood]);
  return <div style={{ width: 650, aspectRatio: '1 / 1' }}><canvas ref={ref} style={{ width: '100%', height: '100%' }} /></div>;
}
```

## 바꾼 점 (v2 대비)

1. **용량**: 12.9MB → 경량 1.02MB / 고화질 3.12MB (meshopt + WebP). 엎드린 모델 1.5MB → 0.18MB.
2. **표정**: 원본 PNG와 나란히 놓고 조정했습니다(`compare/after_v3.jpg`).
   - 눈: 하이라이트를 원본처럼 왼쪽 위로, 눈동자는 더 진하게, 아래쪽은 호박색
   - 눈썹: 더 두껍고 진하게
   - 입: 더 깊은 D자
3. **질감**: 노란색이 바래지 않도록 조명을 원본에 맞춰 낮췄습니다(three r155 이후 조명 단위 변경 반영). 벨벳 광택은 노랗지 않은 중립색으로 바꿨고, 헤드셋·로고·태블릿에만 clearcoat 광택을 줬습니다.
4. **모션**: 마우스·터치 쪽으로 몸을 살짝 돌려 바라봅니다(2.5초 뒤 정면 복귀). 손 흔들기를 시안으로 넣었습니다.
5. **웹앱용**: ES 모듈, 투명 배경, 자동 크기, 화면 밖 일시정지, dispose, 움직임 줄이기 지원.

## v3.1 (원본 맞춤 2차)

비교 그림: `compare/compare_v3.1.jpg` (원본·3D를 같은 칸 크기와 정면 각도로 2쌍, 얼굴·모자 평균 RGB 포함). 겹쳐 보기와 실시간 측정은 `compare.html`에서 볼 수 있습니다.

| 영역 (평균 RGB) | 원본 | v3 | v3.1 |
|---|---|---|---|
| 웃는 얼굴 피부 | 249, 237, 227 | 254, 252, 235 | 251, 235, 227 |
| 모자 노란색 | 253, 220, 75 | 255, 245, 103 | 255, 224, 86 |
| 잠든 얼굴 피부 | 248, 232, 222 | - | 247, 227, 217 |

1. **얼굴 명암**: 원인은 three r16x부터 장면 환경광 세기를 `scene.environmentIntensity`로 조절해야 하는데, v3에서는 효과 없는 `material.envMapIntensity`만 낮췄던 것입니다. 그래서 반사광이 얼굴 전체를 고르게 밝혀 하얗게 날아갔습니다(이마 255). 이제 환경광 0.9, 위쪽 왼편 키 라이트 1.0, 오른쪽 보조광 0.25로 맞췄습니다. 이 값은 원본의 얼굴·이마·턱·양옆·모자 평균색과의 차이가 가장 작은 조합을 자동으로 찾은 결과입니다.
2. **색**: 셰이더에서 피부는 덜 노랗게, 마스코트 노랑은 더 진하게 보정합니다(볼의 분홍은 제외). 보정이 그려 넣은 얼굴에도 똑같이 걸리게 순서를 맞췄습니다.
3. **눈**: 원본과 겹쳐 재서 크기를 키우고 간격을 좁혔습니다. 두 눈 중심이 원본과 1px 이내, 면적이 3% 이내로 맞습니다. 색은 원본에서 뽑았습니다: 바깥 링 52,30,12 / 호박색 199,117,27 / 눈동자 25,11,1.
4. **입**: 폭을 두 눈 간격의 0.45배로 맞췄습니다(원본 비율). 안쪽은 원본의 적갈색(144,69,59)에서 분홍 혀(249,115,118)로 바꿨고, 테두리는 얇은 갈색 선입니다. v3에서 테두리가 혀 둘레에 잘못 그려지던 버그와, 눈 광택이 입 안쪽에 하얗게 걸리던 문제를 고쳤습니다.
5. **코**: 작은 볼록 하이라이트와 아래 그림자를 그려 넣었습니다.
6. **지운 자리 정리**: 눈·눈썹·입을 지운 자리에 피부색을 가장자리를 흐리게 덧칠해서, 눈을 감았을 때 보이던 얼룩을 가렸습니다.
7. **화면 채우기**: 기본 카메라 거리를 7.4에서 6.5로 줄여 칸을 꽉 채우게 했습니다. 점프할 때 위가 잘리지 않을 만큼 여유는 남겼습니다.

## v3.2 (눈썹 자국·잠든 눈·볼터치)

비교 그림: `compare/compare_v3.2.png`

| 영역 (평균 RGB) | 원본 | v3.1 | v3.2 |
|---|---|---|---|
| 웃는 얼굴 피부 | 249, 237, 227 | 251, 235, 227 | 251, 237, 227 |
| 모자 노란색 | 253, 220, 75 | 255, 224, 86 | 255, 224, 85 |
| 잠든 얼굴 피부 | 248, 232, 222 | 247, 227, 217 | 247, 229, 217 |

1. **눈썹 둘레 흰 줄**: 원래 눈썹이 ±0.03만큼 볼록하게 남아 있어 조명을 받아 줄처럼 보였습니다. 눈과 눈썹을 한 영역으로 묶고, 상자 모양으로 평평하게 만드는 대신 주변 곡면을 따라 굴곡만 부드럽게 다듬은 뒤 법선을 다시 계산했습니다. v3.1에서 얼굴에 보이던 네모난 명암 얼룩도 이 상자 경계 때문이었고, 함께 사라졌습니다.
2. **잠든 눈**: 원본처럼 가는 초승달 모양입니다. 가운데가 살짝 두껍고 양끝이 가늘며 아래로 휘고, 바깥쪽 끝이 조금 올라갑니다. 두께는 v3.1 직선의 약 60%입니다.
3. **볼터치**: 모델 텍스처에 박혀 있던 볼을 지우고 그림으로 그립니다. 잠들면 원본처럼 조금 아래·바깥쪽으로 옮겨집니다.
4. **지운 자리 채우기**: 지운 자리를 주변 피부에서 이어받아 채워서(인페인트) 원래 텍스처의 은은한 명암을 살렸습니다.
5. **버그 수정**: 카메라 위치를 애니메이션 루프 안에서만 잡고 있어서, 화면 밖에서 생성되거나 탭이 숨겨진 채 `snapshot()`을 부르면 빈 그림이 나왔습니다. 이제 생성할 때 카메라를 바로 놓고, `snapshot()`이 상태를 한 프레임 진행한 뒤 찍습니다.

바뀐 파일: `narang.js`, `models/narang_full.glb`, `models/narang_lite.glb` (파일 이름 그대로, `sleep.glb`와 정지 그림은 그대로).

## v3.3 (찰흙 느낌 줄이기)

전후 비교: `compare/before_after_v3.3.png` (원본 / v3.2 / v3.3, 같은 조건), 원본 비교: `compare/compare_v3.3.png`, 조명 시안 3종: `compare/v33_variants.png`

| 영역 (평균 RGB) | 원본 | v3.2 | v3.3 |
|---|---|---|---|
| 웃는 얼굴 피부 | 249, 237, 227 | 251, 237, 227 | 252, 239, 229 |
| 모자 노란색 | 253, 220, 75 | 255, 224, 85 | 254, 226, 87 |
| 잠든 얼굴 피부 | 248, 232, 222 | 247, 229, 217 | 248, 230, 218 |

찰흙처럼 보이던 원인은 세 가지였습니다: 생성 모델 표면의 잔 굴곡, 틈새 그림자 부족, 무광 재질.

1. **표면 다듬기**: 이음새를 붙인 상태에서 부피가 줄지 않는 방식(Taubin)으로 표면 전체를 다듬고 법선을 다시 계산했습니다. 잔 굴곡을 더하던 노멀맵은 뺐습니다.
2. **틈새 그림자(AO)**: 정점마다 반구 방향 광선 48개를 쏴서, 모자 테두리 아래, 팔과 몸 사이, 헤드셋 둘레 같은 틈의 그림자를 정점 색(COLOR_0)으로 구웠습니다. 뷰어는 이걸 그대로 곱합니다(`vertexColors`).
3. **소프트비닐 재질**: 거칠기 0.85 → 0.55, 벨벳 광택 0.25 → 0.4, 뒤쪽 위에서 오는 테두리 빛(0.7)을 더했습니다. 반사광은 0.95입니다.
4. 엎드린 모델(`sleep.glb`)에도 같은 처리를 했습니다.

바뀐 파일: `narang.js`, `models/narang_lite.glb` (1.12MB), `models/narang_full.glb` (3.34MB), `models/sleep.glb` (0.26MB).

남은 한계: 잔 굴곡은 줄었지만 얼굴의 큰 굴곡(넓은 울퉁불퉁함)은 생성된 형태 자체라 남아 있습니다. 이걸 없애려면 Blender에서 다시 면을 짜거나(리메시) 모델을 새로 만들어야 합니다.

## v3.4 (감귤 껍질 느낌 줄이기)

비교: `compare/v34_vs_v33.png` (경량 모델, 같은 조건: 전신 / 상반신 / 얼굴 확대 / 잠든 얼굴)

v3.3에서 남은 오톨도톨함(감귤 껍질 느낌)의 원인과 처리:

1. **거칠기 지도의 잡티**: 광택을 올리자 생성 모델의 거칠기 지도(roughness map) 잡티가 반짝임 얼룩으로 드러났습니다. 거칠기 지도를 빼고 거칠기를 0.55로 고르게 했습니다.
2. **색 텍스처 잡티**: 경계(줄무늬·로고)는 지키고 잡티만 지우는 필터(bilateral)로 두 번 정리했습니다.
3. **잔 굴곡**: 표면 다듬기를 10회에서 25회로 늘렸습니다.
4. **얼굴 중앙의 접힌 면**: 눈·입을 메운 자리에 겹친 면이 있어 입 안의 가는 금과 코 옆 흰 점으로 보였습니다. 셰이더에서 얼굴 중앙(가장자리로 갈수록 약하게)은 얼굴 정면 방향으로 고르게 비추고, 그 자리에는 틈새 그림자를 굽지 않게 했습니다.

바뀐 파일: `narang.js`, `models/narang_lite.glb` (1.06MB), `models/narang_full.glb` (3.16MB), `models/sleep.glb` (0.27MB).

## 한계

- 모자 노란색이 원본보다 아주 약간 옅습니다(B 86 vs 75).
- **손 흔들기는 실험적입니다.** 모델에 뼈대가 없어서 정점 셰이더로 손 부분만 구부립니다. 작게 흔들면 자연스럽지만, 손을 높이 들면 손이 위로 늘어나 길쭉해집니다(`compare/wave_2_big_stretched.png`). 그래서 지금은 손이 태블릿 위에서 꼼지락거리는 정도로 제한했습니다. 진짜로 손을 드는 동작에는 뼈대(리깅)가 필요합니다.
- 엎드린 모델은 1크레딧짜리 생성물이라 앉은 모델보다 거칠고, 표정이 바뀌지 않습니다.
- 데모 페이지의 vendor three는 압축하지 않은 원본(약 2MB)입니다. 웹앱에서는 번들러가 필요한 부분만 묶습니다.
