import {groszeToZloty,moneyFromZloty} from '../core/formatters.js';
import {markDirty,amountInput,readAmount,watchForm} from '../core/ux.js';
// Trading mode only: purchase cost and resale scenario of a whole set. The listing link, the
// composition check and unrecognised items live in the Sets view itself (sets.js).
export function mountSetTrading({active,target,json}) {
  const request=(method,path,body)=>json(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const section=document.createElement('section');section.className='set-trading trading-only';target.append(section);
  const costDetails=document.createElement('details');costDetails.className='set-cost-disclosure';const costSummary=document.createElement('summary');costSummary.textContent='Koszt zakupu i kalkulator pakietu';costDetails.append(costSummary);section.append(costDetails);const costs=document.createElement('section');costs.className='set-costs';const costTitle=document.createElement('h4');costTitle.textContent='Koszt zakupu i scenariusz odsprzedaży pakietu';costs.append(costTitle);costDetails.append(costs);
  async function mountCosts() {
    try {
      const [saved,defaults]=await Promise.all([json('/api/offer-scenarios/'+encodeURIComponent(active.offerId)),json('/api/trading-defaults')]);
      if(!costs.isConnected)return;
      const fields={};const labels={purchase:'Planowana cena zakupu (zł)',shipping:'Dostawa (zł)',other:'Inne koszty (zł)',resale:'Zakładana odsprzedaż całego pakietu (zł)',actualPurchase:'Faktyczna cena zakupu (zł)'};
      const complete=!active.unknownItems?.length&&active.editions.length>0&&active.editions.every(item=>item.resalePrice!==null);
      const total=complete?active.editions.reduce((sum,item)=>sum+item.quantity*item.resalePrice,0):null;
      for(const [key,label] of Object.entries(labels)) {
        const value=saved.updatedAt?saved[key]:key==='purchase'?groszeToZloty(active.currentPrice):key==='resale'?total:defaults[key];
        const field=amountInput(label,key,value);fields[key]=field.querySelector('input');costs.append(field);
      }
      const sum=document.createElement('p');sum.textContent=total===null?'Uzupełnij ceny wszystkich składników i rozpoznaj nieznane pozycje, aby uzyskać sumę odsprzedaży.':'Suma założeń dla składników: '+moneyFromZloty(total);costs.append(sum);
      if(total!==null){const use=document.createElement('button');use.type='button';use.className='button secondary';use.textContent='Użyj sumy cen składników';use.addEventListener('click',()=>{fields.resale.value=total;markDirty('set-costs');calculate();});costs.append(use);}
      const output=document.createElement('output');output.className='scenario-result';costs.append(output);
      function calculate(){const values=['purchase','shipping','other','resale'].map(key=>readAmount(fields[key]));if(values.some(value=>value===null||!Number.isFinite(value)||value<0)){output.textContent='Uzupełnij cztery kwoty scenariusza. Wynik nie jest potwierdzoną ceną sprzedaży.';return;}const cost=values[0]+values[1]+values[2];output.textContent='Pełny koszt: '+moneyFromZloty(cost)+' · hipotetyczny wynik: '+moneyFromZloty(values[3]-cost)+' przed podatkiem.';}
      const savedCosts=watchForm('set-costs',Object.values(fields));
      Object.values(fields).forEach(input=>input.addEventListener('input',calculate));calculate();
      const save=document.createElement('button');save.type='button';save.className='button primary';save.textContent='Zapisz scenariusz pakietu';const status=document.createElement('p');status.setAttribute('role','status');costs.append(save,status);
      save.addEventListener('click',async()=>{save.disabled=true;try{await request('PUT','/api/offer-scenarios/'+encodeURIComponent(active.offerId),Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,readAmount(input)])));savedCosts();status.textContent='Zapisano scenariusz. Ceny są Twoimi założeniami.';}catch(error){status.textContent='Nie zapisano. Sprawdź kwoty.';}finally{save.disabled=false;}});
    }catch(error){costs.append(document.createTextNode('Nie udało się odczytać scenariusza. Wybierz zestaw ponownie.'));}
  }
  void mountCosts();
}
