# לוח הפרויקטים

אפליקציית משימות לפי פרויקט – עובדת בטלפון ובמחשב, מותקנת כאפליקציה (PWA).

- **אחסון:** GitHub Pages (`index.html` בשורש המאגר).
- **נתונים והתחברות:** Firebase (פרויקט `projack-manger`) – התחברות עם Google, הנתונים ב-Firestore תחת `users/<uid>/projects` ו-`users/<uid>/tasks`. כל משתמש רואה רק את שלו.
- **הרשאות Firestore:** הכללים ב-`firestore.rules` – להדביק ב-Firebase Console › Firestore › Rules.

קבצים: `index.html` (הממשק), `firebase-store.js` (חיבור ל-Firebase), `manifest.webmanifest` + `sw.js` + אייקונים (התקנה כאפליקציה).
