// scripts/*.spec도 운영 VM에 컨테이너(MySQL·Grafana·Alloy 등)를 띄운다 — 앱 jest와 같은 호스트 락으로 줄 세운다.
import { takeHostLockForRun } from '../src/test/jest-host-lock';

export default takeHostLockForRun;
