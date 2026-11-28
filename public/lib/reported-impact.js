// Only explicit impact in an editor-accepted incident headline enters the severity calculation.
export function reportedEdition(row) {
  const title=String(row.title || "");
  const clean=title.replace(/\[[^\]]+\]\s*/g,"").replace(/[\u00b7\u2027\u30fb]/g,", ");
  const result={id:row.id, date:row.date, name:clean, url:row.url, impact:clean, grade:0, reason:"공개 피해 정보로 등급 미정"};
  const give=(grade,reason)=>{ if (grade>result.grade) Object.assign(result,{grade,reason}); };
  if (/클라우드|상시평가|군사|군용|공공 인증/.test(clean) && /공군|군 공용|금융보안원|인증 인프라/.test(clean)) give(3,"핵심 공용 인프라 침해 보도");
  if (/주요 인증 서비스|공공 인증 플랫폼|군 정보 시스템/.test(clean)) give(3,"핵심 인프라 침해 보도");
  if (/확인 중|가능성|해커 주장|공격자 주장|미확인|미공개|조사 중|유출.{0,8}(부인|없)|추정|여부/.test(clean)) return result;
  if (/공급망.{0,24}(악성코드 배포|고객사.{0,6}감염)/.test(clean)) give(4,"공급망을 통한 피해 전파");
  if (/(?:사흘|나흘|닷새|일주일|수일|장기간).{0,10}(?:서비스|접속).{0,5}중단|(?:서비스|접속).{0,8}(?:사흘|나흘|닷새|일주일).{0,5}중단/.test(clean)) give(3,"대외 서비스 다일 중단");
  if (/생산.{0,5}(차질|중단)|가동 중단/.test(clean)) give(3,"생산 또는 가동 중단");
  if (/정보.{0,8}(유출|탈취)|서비스.{0,5}중단/.test(clean)) give(2,"정보 유출 또는 서비스 중단 보도");
  if (!/마스킹|암호화|뒷자리|앞자리/.test(clean) && /(?:여권|주민등록번호|결제카드|평문 비밀번호).{0,28}(?:접근|유출|탈취)/.test(clean)) give(3,"고위험 식별정보 또는 결제정보 노출");
  if (/탈취|도난|무단 인출|자산 피해/.test(clean) && !/과징금|벌금|보상금|시가총액/.test(clean)) {
    for (const m of clean.matchAll(/([\d,.]+)\s*(억|만|천)?\s*(달러|원)/g)) {
      const amount=Number(m[1].replaceAll(",",""))*({억:1e8,만:1e4,천:1e3}[m[2]] || 1);
      const usd=m[3]==="원"?amount/1400:amount;
      if (usd>0) give(usd>=1e8?4:usd>=1e6?3:2,m[0]+" 금전 피해 보도");
    }
  }
  if (/홈페이지 변조/.test(clean)) give(1,"공개 홈페이지 변조");
  for (const m of clean.matchAll(/([\d,]+(?:\.\d+)?)\s*(억|만|천)?\s*(명|건|계정)(?:분|의|이|을|에|\s|$)/g)) {
    if (!/유출|탈취|노출|침해/.test(clean)) continue;
    const count=Number(m[1].replaceAll(",",""))*({억:1e8,만:1e4,천:1e3}[m[2]] || 1);
    give(count>=1e6?4:count>=1e5?3:2,m[0].trim()+" 규모 보도");
  }
  return result;
}
