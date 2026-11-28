// Only explicit impact in an editor-accepted incident headline enters the severity calculation.
export function reportedEdition(row) {
  const title=String(row.title || "");
  const display=title.replace(/\[[^\]]+\]\s*/g,"");
  const clean=display.replace(/[\u00b7\u2027\u30fb]/g," ");
  const result={id:row.id, date:row.date, name:display, url:row.url, impact:display, grade:0, reason:"공개 피해 정보로 등급 미정"};
  const give=(grade,reason)=>{ if (grade>result.grade) Object.assign(result,{grade,reason}); };
  if (/클라우드|상시평가|군사|군용|공공 인증/.test(clean) && /공군|군 공용|금융보안원|인증 인프라/.test(clean)) give(3,"핵심 공용 인프라 침해 보도");
  if (/주요 인증 서비스|공공 인증 플랫폼|군 정보 시스템/.test(clean)) give(3,"핵심 인프라 침해 보도");
  if (/확인 중|가능성|해커 주장|공격자 주장|미확인|미공개|조사 중|유출.{0,8}(부인|없)|추정|여부/.test(clean)) return result;
  if (/공급망.{0,24}(악성코드 배포|고객사.{0,6}감염)/.test(clean)) give(4,"공급망을 통한 피해 전파");
  if (/(?:사흘|나흘|닷새|일주일|수일|장기간).{0,10}(?:서비스|접속).{0,5}중단|(?:서비스|접속).{0,8}(?:사흘|나흘|닷새|일주일).{0,5}중단/.test(clean)) give(3,"대외 서비스 다일 중단");
  if (/생산.{0,5}(차질|중단)|가동 중단/.test(clean)) give(3,"생산 또는 가동 중단");
  if (/정보.{0,8}(유출|탈취)|서비스.{0,5}중단/.test(clean)) give(2,"정보 유출 또는 서비스 중단 보도");
  if (!/마스킹|암호화|뒷자리|앞자리/.test(clean) && /(?:여권|주민등록번호|결제카드|평문 비밀번호).{0,28}(?:접근|유출|탈취)/.test(clean)) give(3,"고위험 식별정보 또는 결제정보 노출");
  if (/홈페이지 변조/.test(clean)) give(1,"공개 홈페이지 변조");
  for (const m of clean.matchAll(/(\d[\d,]*(?:\.\d+)?(?:\s*[억만천백]\s*(?:\d[\d,]*(?:\.\d+)?)?){0,4}\s*)(?:여\s*)?(달러|원|명|건|계정)/g)) {
    const unit=m[2], after=clean.slice(m.index+m[0].length), before=clean.slice(0,m.index);
    const amount=[...m[1].matchAll(/([\d,]+(?:\.\d+)?)\s*(억|만|천|백)?/g)]
      .reduce((sum,part)=>sum+Number(part[1].replaceAll(",",""))*({억:1e8,만:1e4,천:1e3,백:100}[part[2]] || 1),0);
    if (!(amount>0)) continue;
    if (unit==="원" || unit==="달러") {
      if (/동결|압류|회수|보전|잔액|벌금|과징금|보상|시가총액|거래액/.test(clean)) continue;
      if (!/^\s*(?:(?:상당|규모|어치|이상|가량|약|을|를|이|가)\s*)*(?:무단 인출|탈취|도난|피해)/.test(after) &&
          !/(?:탈취액|탈취한 금액|금전 피해액|무단 인출액)\s*(?:약|총)?\s*$/.test(before)) continue;
      const usd=unit==="원"?amount/1400:amount;
      give(usd>=1e8?4:usd>=1e6?3:2,m[0].trim()+" 금전 피해 보도");
    } else {
      if (/^\s*(?:이\s*)?(?:넘는|달하는|보유|가입|대상으로|규모의)/.test(after)) continue;
      const linked=/^[^,;…]{0,25}(?:유출|탈취|노출|정보 피해)/.test(after) ||
        /(?:유출|탈취|노출)(?:된| 규모| 확인)?\s*(?:고객|이용자|항목|계정|정보)?\s*(?:약|총)?\s*$/.test(before);
      if (linked) give(amount>=1e6?4:amount>=1e5?3:2,m[0].trim()+" 규모 보도");
    }
  }
  return result;
}
