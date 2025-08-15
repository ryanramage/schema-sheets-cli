const { useState, useEffect } = React;
const Form = JSONSchemaForm.default;

function App() {
    const [schema, setSchema] = useState(null);
    const [uiSchema, setUiSchema] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [sessionId, setSessionId] = useState(null);
    const [schemaId, setSchemaId] = useState(null);

    useEffect(() => {
        // Get URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const session = urlParams.get('session');
        const schema = urlParams.get('schema');

        if (!session || !schema) {
            setError('Missing session or schema parameters');
            setLoading(false);
            return;
        }

        setSessionId(session);
        setSchemaId(schema);

        // Fetch both schema and UI schema
        Promise.all([
            fetch(`/api/schema/${schema}?session=${session}`),
            fetch(`/api/uischema/${schema}?session=${session}`)
        ])
        .then(async ([schemaResponse, uiSchemaResponse]) => {
            if (!schemaResponse.ok) {
                throw new Error('Failed to load schema');
            }
            
            const schemaData = await schemaResponse.json();
            setSchema(schemaData);
            
            // UI schema is optional - don't throw error if 404
            if (uiSchemaResponse.ok) {
                const uiSchemaData = await uiSchemaResponse.json();
                setUiSchema(uiSchemaData);
            }
            
            setLoading(false);
        })
        .catch(err => {
            setError(err.message);
            setLoading(false);
        });
    }, []);

    const handleSubmit = async ({ formData }) => {
        setSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/submit', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    sessionId,
                    formData
                })
            });

            if (!response.ok) {
                throw new Error('Failed to submit form');
            }

            setSuccess(true);
            setTimeout(() => {
                window.close();
            }, 2000);
        } catch (err) {
            setError(err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async () => {
        try {
            await fetch('/api/close', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionId })
            });
        } catch (err) {
            console.error('Error closing session:', err);
        }
        window.close();
    };

    if (loading) {
        return React.createElement('div', { className: 'loading' }, 'Loading form...');
    }

    if (success) {
        return React.createElement('div', { className: 'container' },
            React.createElement('div', { className: 'alert alert-success text-center' },
                React.createElement('h2', { className: 'alert-heading' }, '✅ Success!'),
                React.createElement('p', { className: 'mb-0' }, 'Form submitted successfully. This window will close automatically.')
            )
        );
    }

    return React.createElement('div', { className: 'container' },
        React.createElement('div', { className: 'header' },
            React.createElement('h1', null, 'Add New Row'),
            React.createElement('p', null, 'Fill out the form below based on the schema')
        ),
        error && React.createElement('div', { className: 'alert alert-danger' }, error),
        schema && React.createElement('div', null,
            React.createElement(Form, {
                schema: schema,
                ...(uiSchema && { uiSchema: uiSchema }),
                onSubmit: handleSubmit,
                disabled: submitting
            }),
            React.createElement('div', { className: 'form-actions' },
                React.createElement('button', {
                    type: 'button',
                    className: 'btn btn-outline-secondary',
                    onClick: handleCancel,
                    disabled: submitting
                }, 'Cancel'),
                React.createElement('button', {
                    type: 'button',
                    className: 'btn btn-primary',
                    disabled: submitting,
                    onClick: () => {
                        const form = document.querySelector('form');
                        if (form) {
                            form.requestSubmit();
                        }
                    }
                }, submitting ? 
                    React.createElement('span', null,
                        React.createElement('span', { 
                            className: 'spinner-border spinner-border-sm me-2',
                            role: 'status',
                            'aria-hidden': 'true'
                        }),
                        'Submitting...'
                    ) : 'Submit'
                )
            )
        )
    );
}

// Render the app
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
