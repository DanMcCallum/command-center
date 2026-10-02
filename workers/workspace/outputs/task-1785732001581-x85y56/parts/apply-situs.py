import csv, json
# APN (as in CSV) -> (p_address, p_city, p_zip)
D={
 # Pinal - assessor situs (Eloy 85131)
 "403-18-188":("4620 N Toltec Rd","Eloy","85131"),
 "404-02-056":("4455 N Rillito Cir","Eloy","85131"),
 "404-02-059":("4450 N Cortez Dr","Eloy","85131"),
 "404-02-092":("4445 N Cortez Dr","Eloy","85131"),
 "404-18-038":("3655 N Palm Cir","Eloy","85131"),   # seller wrote 3659 - assessor says 3655
 "404-18-061":("3740 N Palm Cir","Eloy","85131"),
 "404-18-062":("3730 N Palm Cir","Eloy","85131"),
 "404-18-066":("3640 N Palm Cir","Eloy","85131"),
 "404-19-161":("3415 N Bandelier Dr","Eloy","85131"),
 # Pinal 511-70 - no situs address on record; APN locator used
 "511-70-004G":("APN 511-70-004G","Casa Grande","85193"),
 "511-70-010a":("APN 511-70-010A","Casa Grande","85193"),
 "511-70-017a":("APN 511-70-017A","Casa Grande","85193"),
 "511-70-017b":("APN 511-70-017B","Casa Grande","85193"),
 "511-70-017c":("APN 511-70-017C","Casa Grande","85193"),
 "511-70-018":("APN 511-70-018","Casa Grande","85193"),
 # Apache / Mohave - no situs address on record
 "202-04-006":("APN 202-04-006","St. Johns","85936"),
 "353-17-068":("APN 353-17-068","Kingman","86401"),
 # Cochise - no situs address on record
 "116-09-340":("APN 116-09-340","Cochise","85606"),
 "116-09-341":("APN 116-09-341","Cochise","85606"),
 "117-02-118":("APN 117-02-118","Pearce","85625"),
 "117-02-141":("APN 117-02-141","Pearce","85625"),
 # Santa Cruz - assessor situs (Rio Rico 85648)
 "119-01-116":("1930 Circulo Huerta","Rio Rico","85648"),
 "119-01-139":("412 Pelicano Ct","Rio Rico","85648"),
 "119-01-365":("430 Circulo Uva","Rio Rico","85648"),
 "132-04-171":("1744 Via Caguama","Rio Rico","85648"),
 "132-04-265":("326 Cuna Ct","Rio Rico","85648"),
 "132-04-300":("368 Circulo Hormiga","Rio Rico","85648"),
 "132-06-076":("403 Brisa Ct","Rio Rico","85648"),
 "133-03-353":("293 Zola Ct","Rio Rico","85648"),
 "133-03-354":("290 Bagre Ct","Rio Rico","85648"),
 "133-03-355":("292 Bagre Ct","Rio Rico","85648"),
 "133-03-356":("294 Bagre Ct","Rio Rico","85648"),
 "133-03-450":("227 Caiman Ct","Rio Rico","85648"),
 # Yavapai - assessor situs, county E-911 post office = Rimrock 86335
 "405-06-552":("4830 N Totem Pole Pass","Rimrock","86335"),
 "405-06-554":("4810 N Totem Pole Pass","Rimrock","86335"),
}
MAIL={"m_address":"801 W Birch Ave","m_city":"Flagstaff","m_state":"AZ","m_zip":"86001"}
rows=list(csv.reader(open("import.csv",newline="")))
hdr=rows[0]; ix={c:i for i,c in enumerate(hdr)}
changed=0; missing=[]
for r in rows[1:]:
    apn=r[ix["p_apn"]]
    if apn not in D: missing.append(apn); continue
    a,c,z=D[apn]
    r[ix["p_address"]],r[ix["p_city"]],r[ix["p_zip"]]=a,c,z
    for k,v in MAIL.items(): r[ix[k]]=v
    changed+=1
with open("import.csv","w",newline="") as f:
    csv.writer(f,lineterminator="\n").writerows(rows)
print("rows updated:",changed,"| unmatched APNs:",missing)
