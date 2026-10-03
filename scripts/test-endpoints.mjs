const BASE_URL = 'http://localhost:4300';

async function runTests() {
  const results = [];
  let adminToken = '';
  let agentToken = '';

  function log(name, passed, detail) {
    results.push({ name, passed, detail });
    console.log(`${passed ? '✅ PASS' : '❌ FAIL'}: ${name} ${detail ? `(${detail})` : ''}`);
  }

  // 1. Health check
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    const data = await res.json();
    log('GET /api/health', res.ok && data.ok === true, `status: ${res.status}`);
  } catch (err) {
    log('GET /api/health', false, err.message);
  }

  // 2. OpenAPI Spec JSON
  try {
    const res = await fetch(`${BASE_URL}/api/openapi.json`);
    const data = await res.json();
    log('GET /api/openapi.json', res.ok && !!data.openapi, `OpenAPI v${data.openapi}`);
  } catch (err) {
    log('GET /api/openapi.json', false, err.message);
  }

  // 3. Admin Login (using Admin@123456 & portal: admin)
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@asasurealty.com', password: 'Admin@123456', portal: 'admin' })
    });
    const data = await res.json();
    adminToken = data.token;
    log('POST /api/auth/login (Admin Portal)', res.ok && !!data.token, `role: ${data.role}`);
  } catch (err) {
    log('POST /api/auth/login (Admin Portal)', false, err.message);
  }

  // 3b. Portal separation: Agent trying to log in via Admin Portal (should be 403)
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agent@asasurealty.com', password: 'Agent@2026', portal: 'admin' })
    });
    log('POST /api/auth/login (Agent on Admin Portal denied)', res.status === 403, `status: ${res.status}`);
  } catch (err) {
    log('POST /api/auth/login (Agent on Admin Portal denied)', false, err.message);
  }

  // 4. Agent Login (using portal: user)
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'agent@asasurealty.com', password: 'Agent@2026', portal: 'user' })
    });
    const data = await res.json();
    agentToken = data.token;
    log('POST /api/auth/login (Agent Portal)', res.ok && !!data.token, `role: ${data.role}`);
  } catch (err) {
    log('POST /api/auth/login (Agent Portal)', false, err.message);
  }

  // 4b. Portal separation: Admin trying to log in via Partner Portal (should be 403)
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@asasurealty.com', password: 'Admin@123456', portal: 'user' })
    });
    log('POST /api/auth/login (Admin on Partner Portal denied)', res.status === 403, `status: ${res.status}`);
  } catch (err) {
    log('POST /api/auth/login (Admin on Partner Portal denied)', false, err.message);
  }

  // 5. Invalid Credentials Rejection
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@asasurealty.com', password: 'bad_password' })
    });
    log('POST /api/auth/login (Bad Credentials)', res.status === 401, `status: ${res.status}`);
  } catch (err) {
    log('POST /api/auth/login (Bad Credentials)', false, err.message);
  }

  // 6. User Registration
  const testEmail = `partner_${Date.now()}@asasurealty.com`;
  try {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'New Registered Partner',
        email: testEmail,
        password: 'Password@123',
        role: 'AGENT',
        agency: 'ASASU Partner Network',
        branch: 'Abuja',
        phone: '+234 812 345 6789'
      })
    });
    const data = await res.json();
    log('POST /api/auth/register', res.ok && data.email === testEmail, `registered: ${data.email}`);
  } catch (err) {
    log('POST /api/auth/register', false, err.message);
  }

  // 7. GET /api/me (Current authenticated profile)
  try {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json();
    log('GET /api/me', res.ok && data.email === 'admin@asasurealty.com', `name: ${data.name}`);
  } catch (err) {
    log('GET /api/me', false, err.message);
  }

  // 8. PATCH /api/me/payment-account
  try {
    const res = await fetch(`${BASE_URL}/api/me/payment-account`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`
      },
      body: JSON.stringify({
        bankName: 'Zenith Bank',
        accountName: 'Tunde Balogun',
        accountNumber: '2001234567',
        phone: '+234 800 000 0002'
      })
    });
    const data = await res.json();
    log('PATCH /api/me/payment-account', res.ok && data.paymentAccount?.bankName === 'Zenith Bank', `bank: ${data.paymentAccount?.bankName}`);
  } catch (err) {
    log('PATCH /api/me/payment-account', false, err.message);
  }

  // 9. GET /api/dashboard
  try {
    const res = await fetch(`${BASE_URL}/api/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json();
    const hasMetrics = data.metrics && typeof data.metrics.totalCommissionEarned === 'number';
    log('GET /api/dashboard', res.ok && hasMetrics, `totalEarned: ₦${data.metrics?.totalCommissionEarned.toLocaleString()}, schedules: ${data.schedules?.length}`);
  } catch (err) {
    log('GET /api/dashboard', false, err.message);
  }

  // 10. GET /api/payment-schedules/:scheduleId/entries
  try {
    const res = await fetch(`${BASE_URL}/api/payment-schedules/sch_20jul2026/entries`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json();
    log('GET /api/payment-schedules/:scheduleId/entries', res.ok && Array.isArray(data.rows), `rows: ${data.rows?.length}, total: ${data.total}`);
  } catch (err) {
    log('GET /api/payment-schedules/:scheduleId/entries', false, err.message);
  }

  // 11. GET /api/tickets
  try {
    const res = await fetch(`${BASE_URL}/api/tickets`, {
      headers: { Authorization: `Bearer ${agentToken}` }
    });
    const data = await res.json();
    log('GET /api/tickets', res.ok && Array.isArray(data), `count: ${data.length}`);
  } catch (err) {
    log('GET /api/tickets', false, err.message);
  }

  // 12. POST /api/tickets
  let ticketId = '';
  try {
    const res = await fetch(`${BASE_URL}/api/tickets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`
      },
      body: JSON.stringify({
        subject: 'Inquiry regarding payment disbursement schedule',
        description: 'Hello, please confirm the expected payment schedule date for row 4.',
        priority: 'MEDIUM'
      })
    });
    const data = await res.json();
    ticketId = data.id;
    log('POST /api/tickets', res.status === 201 && !!data.id, `ticketId: ${data.id}`);
  } catch (err) {
    log('POST /api/tickets', false, err.message);
  }

  // 13. POST /api/tickets/:ticketId/replies
  if (ticketId) {
    try {
      const res = await fetch(`${BASE_URL}/api/tickets/${ticketId}/replies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`
        },
        body: JSON.stringify({
          body: 'This schedule will be disbursed by Wednesday morning.'
        })
      });
      const data = await res.json();
      log('POST /api/tickets/:ticketId/replies', res.ok && Array.isArray(data.replies), `repliesCount: ${data.replies?.length}`);
    } catch (err) {
      log('POST /api/tickets/:ticketId/replies', false, err.message);
    }
  }

  // 14. POST /api/claims
  try {
    const res = await fetch(`${BASE_URL}/api/claims`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentToken}`
      },
      body: JSON.stringify({
        scheduleId: 'sch_20jul2026',
        scheduleEntryIds: ['sch_ent_2'],
        commissionRate: 0.01
      })
    });
    const data = await res.json();
    log('POST /api/claims', res.status === 201 && !!data.id, `claimRef: ${data.reference}`);
  } catch (err) {
    log('POST /api/claims', false, err.message);
  }

  // 15. GET /api/payments/export.csv
  try {
    const res = await fetch(`${BASE_URL}/api/payments/export.csv`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const text = await res.text();
    log('GET /api/payments/export.csv', res.ok && text.includes('Payment ID'), `csvBytes: ${text.length}`);
  } catch (err) {
    log('GET /api/payments/export.csv', false, err.message);
  }

  // 16. DELETE /api/users/:userId - Agent denied (403)
  try {
    const res = await fetch(`${BASE_URL}/api/users/usr_developer`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${agentToken}` }
    });
    log('DELETE /api/users/:userId (Agent denied)', res.status === 403, `status: ${res.status}`);
  } catch (err) {
    log('DELETE /api/users/:userId (Agent denied)', false, err.message);
  }

  // 17. DELETE /api/users/:userId - Self-deletion blocked (400)
  try {
    const res = await fetch(`${BASE_URL}/api/users/usr_admin`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    log('DELETE /api/users/:userId (Self-deletion blocked)', res.status === 400, `status: ${res.status}`);
  } catch (err) {
    log('DELETE /api/users/:userId (Self-deletion blocked)', false, err.message);
  }

  // 18. Register temporary user then delete by Admin
  try {
    const regRes = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Delete Test User',
        email: `deltest_${Date.now()}@asasurealty.com`,
        password: 'Password@123',
        agency: 'Test Agency',
        role: 'AGENT'
      })
    });
    const regData = await regRes.json();
    const tempUserId = regData.id;

    if (tempUserId) {
      const delRes = await fetch(`${BASE_URL}/api/users/${tempUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const delData = await delRes.json();
      log('DELETE /api/users/:userId (Admin success)', delRes.status === 200 && delData.ok === true, `deleted: ${tempUserId}`);

      const repeatRes = await fetch(`${BASE_URL}/api/users/${tempUserId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      log('DELETE /api/users/:userId (Already deleted 404)', repeatRes.status === 404, `status: ${repeatRes.status}`);
    } else {
      log('DELETE /api/users/:userId (Admin success)', false, 'Could not create temp user');
    }
  } catch (err) {
    log('DELETE /api/users/:userId (Admin success)', false, err.message);
  }

  console.log('\n=======================================');
  const passedCount = results.filter(r => r.passed).length;
  console.log(`Summary: ${passedCount}/${results.length} Endpoints Passed`);
  console.log('=======================================');
}

runTests();
