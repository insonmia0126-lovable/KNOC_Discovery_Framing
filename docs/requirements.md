# 요구 추적 (P0 중심)

| 요구 | 구현 | 검증 |
|---|---|---|
| 다중 PDF·TXT 등록, 폴더 선택 | 자료실 업로드 | 화면. 자동 테스트는 시드 등록 |
| 페이지 출처 | chunks.physical_page, printed_page | 추출 테스트 포함 시드 |
| 검색과 원문 | 후보 목록, 근거 패널 | Recall 테스트 |
| 상황, 유사 사례, 차이 | 인수인계 화면 | frame 테스트 |
| 카드 편집·확정·인수 | 상태 기계, review_events | 역할 거부 포함 테스트 |
| 영속 | SQLite | 재오픈 테스트 |
| Markdown·JSON·인쇄 | export, print | 내보내기 API |
| 데모와 실제 모델 분리 | settings.mode. 실패 시 데모로 대체하지 않음 | 데모 플래그 테스트. 실제 호출은 키 없음으로 미실시 |
| 6,000개와 실처리 구분 | 통계 문구, fullCorpusVerification 미실시 | 테스트 |
| 당시/사후 모드 | eligibleByTime | 테스트 |
| 권한 제한 문서 | rights restricted, 본문 API 403 | 테스트 |
| P1 일부 XLSX·일정 | 일정표 행을 다음 행동으로 | 시드 |
| P1 작업 큐 | index_jobs | 손상 PDF가 실패로 남음 |
| OCR·HWP·실시간·SSO | 미구현. 설정에 미지원으로 표시 | 해당 없음 |
